// Cliente de la API de PinPad de Clip (cobro en terminal física desde el POS).
// Docs: https://developer.clip.mx/reference/introducci%C3%B3n-a-la-api-de-pinpad
//
// Cada marca tiene su propia cuenta Clip y por lo tanto sus propias claves:
//   Läätu  -> CLIP_LAATU_API_KEY  / CLIP_LAATU_SECRET
//   Goodes -> CLIP_GOODES_API_KEY / CLIP_GOODES_SECRET
// Estas NO son las mismas que CLIP_API_KEY / CLIP_SECRET_KEY (cobros en línea).

const PINPAD_API_BASE = "https://api.payclip.io/f2f/pinpad/v1";

export type PosBrand = "laatu" | "goodes";

export const BRAND_LABEL: Record<PosBrand, string> = {
  laatu: "Läätu",
  goodes: "Goodes",
};

function pinpadAuth(brand: PosBrand): string {
  const prefix = brand === "goodes" ? "CLIP_GOODES" : "CLIP_LAATU";
  const apiKey = process.env[`${prefix}_API_KEY`];
  const secret = process.env[`${prefix}_SECRET`];
  if (!apiKey || !secret) {
    throw new Error(
      `La terminal de ${BRAND_LABEL[brand]} no tiene credenciales de Clip configuradas (${prefix}_API_KEY / ${prefix}_SECRET).`,
    );
  }
  return `Basic ${Buffer.from(`${apiKey}:${secret}`).toString("base64")}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function friendlyError(status: number, json: Record<string, unknown>): string {
  const code = String(json["code"] ?? "");
  if (code === "PINPAD_TERMINAL_TIMEOUT_EXCEPTION" || status === 504) {
    return "La terminal no respondió. Revisa que esté encendida, con internet y con la app PinPad abierta.";
  }
  if (status === 401 || status === 403) {
    return "Clip rechazó las credenciales de esta terminal. Revisa las claves de API.";
  }
  const message = json["message"] ? String(json["message"]) : "";
  return `Clip respondió ${status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`;
}

export interface CreatePinpadPaymentInput {
  brand: PosBrand;
  amountCents: number;
  reference: string;
  serialNumber: string;
  webhookUrl: string;
}

export async function createPinpadPayment(
  input: CreatePinpadPaymentInput,
): Promise<{ pinpadRequestId: string }> {
  const response = await fetch(`${PINPAD_API_BASE}/payment`, {
    method: "POST",
    headers: {
      Authorization: pinpadAuth(input.brand),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: (input.amountCents / 100).toFixed(2),
      reference: input.reference,
      serial_number_pos: input.serialNumber,
      webhook_url: input.webhookUrl,
      preferences: {
        // false: la terminal se queda en la pantalla del pago aprobado, donde
        // Clip muestra las opciones de imprimir / enviar el ticket.
        is_auto_return_enabled: false,
        is_tip_enabled: false,
        is_msi_enabled: false,
        is_mci_enabled: false,
        is_dcc_enabled: false,
        is_retry_enabled: true,
        // Botones para imprimir otra copia o mandar el ticket por SMS / correo.
        is_share_enabled: true,
        // No imprime solo: al aprobarse el pago la terminal muestra las opciones y
        // el cliente elige si quiere ticket impreso, por SMS/correo o ninguno.
        is_auto_print_receipt_enabled: false,
        is_split_payment_enabled: false,
      },
    }),
  });

  const json = await readJson(response);
  if (!response.ok) throw new Error(friendlyError(response.status, json));

  const id = json["pinpad_request_id"];
  if (!id) throw new Error("Clip no regresó el identificador del cobro.");
  return { pinpadRequestId: String(id) };
}

export interface PinpadPaymentDetail {
  found: boolean;
  status: string; // COMPLETED | PENDING | FAILED | ...
  amountCents?: number | undefined;
  amountPaidCents?: number | undefined;
  cardLast4?: string | undefined;
  cardBrand?: string | undefined;
  // Identificadores del pago aprobado en Clip (para pedir reembolsos).
  clipPaymentIds: string[];
  receiptNo?: string | undefined;
}

function toCents(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

export async function getPinpadPayment(
  brand: PosBrand,
  pinpadRequestId: string,
): Promise<PinpadPaymentDetail> {
  const url = `${PINPAD_API_BASE}/payment?pinpadRequestId=${encodeURIComponent(pinpadRequestId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: pinpadAuth(brand),
      "Pinpad-Include-Detail": "true",
    },
  });

  const json = await readJson(response);
  if (response.status === 404) return { found: false, status: "NOT_FOUND", clipPaymentIds: [] };
  if (!response.ok) throw new Error(friendlyError(response.status, json));

  const detail = json["detail"] as { results?: Record<string, unknown>[] } | undefined;
  const approved = (detail?.results ?? []).find(
    (r) => String(r["status"] ?? "").toLowerCase() === "approved",
  );
  const pm = approved?.["payment_method"] as
    { id?: string; card?: { last_digits?: string } } | undefined;

  return {
    found: true,
    status: String(json["status"] ?? "UNKNOWN").toUpperCase(),
    amountCents: toCents(json["amount"]),
    amountPaidCents: toCents(json["amount_paid"]),
    cardLast4: pm?.card?.last_digits,
    cardBrand: pm?.id,
    clipPaymentIds: approved
      ? [approved["id"], approved["transaction_id"]].filter(Boolean).map(String)
      : [],
    receiptNo: approved?.["receipt_no"] ? String(approved["receipt_no"]) : undefined,
  };
}

// Solo funciona si la terminal todavía no tomó el cobro. Si ya lo tomó, el
// cliente tiene que cancelarlo en la propia terminal.
export async function cancelPinpadPayment(
  brand: PosBrand,
  pinpadRequestId: string,
): Promise<{ canceled: boolean; message?: string }> {
  const response = await fetch(
    `${PINPAD_API_BASE}/payment/${encodeURIComponent(pinpadRequestId)}`,
    {
      method: "DELETE",
      headers: { Authorization: pinpadAuth(brand) },
    },
  );
  if (response.ok) return { canceled: true };
  const json = await readJson(response);
  return { canceled: false, message: friendlyError(response.status, json) };
}

// ---------------------------------------------------------------------------
// Reembolsos (API de Reembolsos de Clip).
// Docs: https://developer.clip.mx/reference/post_refunds
// Si la credencial de PinPad no tiene permiso de reembolsos, se puede crear
// otra de tipo "Generación de reembolsos" y guardarla como
// CLIP_<MARCA>_REFUND_API_KEY / CLIP_<MARCA>_REFUND_SECRET.
// ---------------------------------------------------------------------------
const REFUNDS_API = "https://api.payclip.com/refunds";

function refundAuth(brand: PosBrand): string {
  const prefix = brand === "goodes" ? "CLIP_GOODES" : "CLIP_LAATU";
  const apiKey = process.env[`${prefix}_REFUND_API_KEY`];
  const secret = process.env[`${prefix}_REFUND_SECRET`];
  if (apiKey && secret) return `Basic ${Buffer.from(`${apiKey}:${secret}`).toString("base64")}`;
  return pinpadAuth(brand);
}

export async function refundClipPayment(input: {
  brand: PosBrand;
  amountCents: number;
  reason: string;
  references: { type: "transaction" | "receipt"; id: string }[];
  idempotencyKey: string;
}): Promise<{ refundId: string }> {
  let lastError = "Clip no encontró el pago para reembolsarlo.";
  for (const reference of input.references) {
    const response = await fetch(REFUNDS_API, {
      method: "POST",
      headers: {
        Authorization: refundAuth(input.brand),
        "Content-Type": "application/json",
        "idempotency-key": `${input.idempotencyKey}-${reference.id}`,
      },
      body: JSON.stringify({
        amount: Number((input.amountCents / 100).toFixed(2)),
        reason: input.reason.slice(0, 120) || "Reembolso",
        reference,
      }),
    });
    const json = await readJson(response);
    if (response.ok) {
      const status = String(json["status"] ?? "approved").toLowerCase();
      if (status === "declined" || status === "rejected") {
        throw new Error("Clip rechazó el reembolso. Revisa el saldo del día en tu cuenta Clip.");
      }
      return { refundId: String(json["id"] ?? json["refund_id"] ?? "") };
    }
    const code = String(json["code"] ?? json["error_code"] ?? "");
    if (response.status === 404) {
      lastError = "Clip no encontró el pago para reembolsarlo.";
      continue; // se intenta con el siguiente identificador
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `La credencial de Clip de ${BRAND_LABEL[input.brand]} no tiene permiso para reembolsos. Crea en Clip una credencial de "Generación de reembolsos".`,
      );
    }
    if (code === "AI1400")
      throw new Error("No hay saldo suficiente del día en Clip para reembolsar.");
    if (code === "AI1803")
      throw new Error("Ya pasaron más de 180 días; Clip no permite reembolsarlo.");
    if (code === "AI1801")
      throw new Error("El monto excede lo cobrado o ya fue reembolsado en Clip.");
    throw new Error(friendlyError(response.status, json));
  }
  throw new Error(lastError);
}

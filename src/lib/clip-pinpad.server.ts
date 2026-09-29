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
        is_auto_return_enabled: true,
        is_tip_enabled: false,
        is_msi_enabled: false,
        is_mci_enabled: false,
        is_dcc_enabled: false,
        is_retry_enabled: true,
        is_share_enabled: false,
        is_auto_print_receipt_enabled: true,
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
  if (response.status === 404) return { found: false, status: "NOT_FOUND" };
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

const CLIP_API_BASE = "https://api.payclip.com/v2";

function getBasicAuth(): string {
  const apiKey = process.env["CLIP_API_KEY"];
  const secret = process.env["CLIP_SECRET_KEY"];
  if (!apiKey || !secret) {
    throw new Error("Las credenciales de Clip no están configuradas");
  }
  return `Basic ${Buffer.from(`${apiKey}:${secret}`).toString("base64")}`;
}

export interface ClipPaymentLinkInput {
  amount: number;
  currency: string;
  purchaseDescription: string;
  successUrl: string;
  errorUrl: string;
  defaultUrl: string;
  webhookUrl: string;
  metadata?: Record<string, string>;
  expiresAt?: string;
}

export interface ClipPaymentLink {
  paymentRequestId: string;
  paymentRequestUrl: string;
  status: string;
  qrImageUrl?: string | undefined;
  expiresAt?: string | undefined;
}

function normalizeAmount(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export async function createClipPaymentLink(
  input: ClipPaymentLinkInput,
): Promise<ClipPaymentLink> {
  const body: Record<string, unknown> = {
    amount: normalizeAmount(input.amount),
    currency: input.currency,
    purchase_description: input.purchaseDescription.slice(0, 150),
    redirection_url: {
      success: input.successUrl,
      error: input.errorUrl,
      default: input.defaultUrl,
    },
    webhook_url: input.webhookUrl,
  };

  if (input.metadata && Object.keys(input.metadata).length) {
    body["metadata"] = input.metadata;
  }
  if (input.expiresAt) {
    body["expires_at"] = input.expiresAt;
  }

  const response = await fetch(`${CLIP_API_BASE}/checkout`, {
    method: "POST",
    headers: {
      Authorization: getBasicAuth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Clip error ${response.status}: ${text || response.statusText}`);
  }

  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  return {
    paymentRequestId: String(json["payment_request_id"]),
    paymentRequestUrl: String(json["payment_request_url"]),
    status: String(json["status"] ?? "CREATED"),
    qrImageUrl: json["qr_image_url"] ? String(json["qr_image_url"]) : undefined,
    expiresAt: json["expires_at"] ? String(json["expires_at"]) : undefined,
  };
}

export interface ClipPaymentStatus {
  paymentRequestId: string;
  status: string;
  amount?: number | undefined;
  currency?: string | undefined;
  metadata?: Record<string, string> | null | undefined;
}

export async function getClipPaymentStatus(paymentRequestId: string): Promise<ClipPaymentStatus> {
  const response = await fetch(`${CLIP_API_BASE}/checkout/${paymentRequestId}`, {
    method: "GET",
    headers: {
      Authorization: getBasicAuth(),
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Clip status error ${response.status}: ${text || response.statusText}`);
  }

  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  return {
    paymentRequestId: String(json["payment_request_id"]),
    status: String(json["status"] ?? "UNKNOWN"),
    amount: typeof json["amount"] === "number" ? json["amount"] : undefined,
    currency: json["currency"] ? String(json["currency"]) : undefined,
    metadata: (json["metadata"] as Record<string, string> | null | undefined) ?? null,
  };
}

export function isClipPaymentCompleted(status: string): boolean {
  return /completed/i.test(status);
}

export function getClipErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "No pudimos comunicarnos con Clip. Intenta de nuevo.";
}

export async function fulfillClipOrder(supabaseAdmin: any, order: any) {
  const externalRef = order["external_ref"] ?? `clip_${order["payment_request_id"]};

  if (order["kind"] === "plan") {
    const { error } = await (supabaseAdmin.rpc as any)("fulfill_plan_purchase", {
      _user_id: order["user_id"],
      _plan_id: order["plan_id"],
      _external_ref: externalRef,
      _payment_method: "tarjeta",
    });
    if (error) throw new Error(`fulfill_plan_purchase: ${JSON.stringify(error)}`);
  } else if (order["kind"] === "merch") {
    const { error } = await (supabaseAdmin.rpc as any)("fulfill_merch_order", {
      _user_id: order["user_id"],
      _product_id: order["product_id"],
      _qty: order["qty"] ?? 1,
      _external_ref: externalRef,
    });
    if (error) throw new Error(`fulfill_merch_order: ${JSON.stringify(error)}`);
  } else if (order["kind"] === "merch_cart") {
    const { error } = await (supabaseAdmin.rpc as any)("fulfill_merch_cart_order", {
      _user_id: order["user_id"],
      _items: order["items"] ?? [],
      _external_ref: externalRef,
    });
    if (error) throw new Error(`fulfill_merch_cart_order: ${JSON.stringify(error)}`);
  }
}

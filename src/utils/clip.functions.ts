import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createClipPaymentLink,
  getClipPaymentStatus,
  fulfillClipOrder,
  isClipPaymentCompleted,
  getClipErrorMessage,
} from "@/lib/clip.server";

function validateOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Origen inválido");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Origen inválido");
  }
  return `${url.protocol}//${url.host}`;
}

function clipWebhookUrl(origin: string): string {
  const token = process.env["CLIP_WEBHOOK_SECRET"];
  if (!token) throw new Error("CLIP_WEBHOOK_SECRET no está configurado");
  return `${origin}/api/public/clip/webhook?token=${token}`;
}

function externalRef(): string {
  return globalThis.crypto.randomUUID();
}

function expireAt(minutes = 30): string {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString();
}

function normalizeAmount(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

async function ensureProfileEmail(
  supabase: any,
  userId: string,
  claimsEmail?: string,
): Promise<string | undefined> {
  if (claimsEmail) return claimsEmail;
  const { data } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  return data?.email;
}

type PlanCheckoutInput = { planId: string; origin: string };
type MerchCheckoutInput = {
  productId: string;
  productName: string;
  priceCents: number;
  qty: number;
  origin: string;
};
type MerchCartCheckoutInput = {
  items: { productId: string; productName: string; priceCents: number; qty: number }[];
  origin: string;
};

export const createPlanClipCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: PlanCheckoutInput) => {
    if (!/^[a-f0-9-]{36}$/i.test(data.planId)) throw new Error("planId inválido");
    if (typeof data.origin !== "string" || !data.origin) throw new Error("origin requerido");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ paymentUrl: string; orderId: string }> => {
    const origin = validateOrigin(data.origin);
    const { supabase, userId, claims } = context;

    const { data: plan, error: planError } = await supabase
      .from("token_plans")
      .select("id, name, price_cents, currency, tokens, active")
      .eq("id", data.planId)
      .single();

    if (planError || !plan) throw new Error("Paquete no encontrado");
    if (!plan.active) throw new Error("Paquete no disponible");

    const email = await ensureProfileEmail(supabase, userId, claims?.email);
    const ref = externalRef();
    const amountCents = plan.price_cents;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: orderError } = await (supabaseAdmin.from as any)("clip_orders")
      .insert({
        kind: "plan",
        user_id: userId,
        plan_id: plan.id,
        amount_cents: amountCents,
        currency: plan.currency ?? "MXN",
        description: plan.name,
        external_ref: ref,
        metadata: { tokens: plan.tokens, email },
      })
      .select()
      .single();

    if (orderError || !order) {
      throw new Error("No se pudo crear la orden de pago");
    }

    try {
      const link = await createClipPaymentLink({
        amount: amountCents,
        currency: plan.currency ?? "MXN",
        purchaseDescription: `Läätu — ${plan.name}`,
        successUrl: `${origin}/checkout/return?clip_order_id=${order.id}`,
        errorUrl: `${origin}/checkout/return?clip_order_id=${order.id}&error=1`,
        defaultUrl: `${origin}/checkout/return?clip_order_id=${order.id}`,
        webhookUrl: clipWebhookUrl(origin),
        metadata: {
          kind: "plan",
          plan_id: plan.id,
          user_id: userId,
          external_ref: ref,
        },
        expiresAt: expireAt(),
      });

      await (supabaseAdmin.from as any)("clip_orders")
        .update({
          payment_request_id: link.paymentRequestId,
          status: mapClipStatus(link.status),
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      return { paymentUrl: link.paymentRequestUrl, orderId: order.id };
    } catch (error) {
      await (supabaseAdmin.from as any)("clip_orders")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", order.id);
      throw new Error(getClipErrorMessage(error));
    }
  });

export const createMerchClipCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: MerchCheckoutInput) => {
    if (!/^[a-f0-9-]{36}$/i.test(data.productId)) throw new Error("productId inválido");
    if (!Number.isInteger(data.qty) || data.qty < 1 || data.qty > 50) throw new Error("Cantidad inválida");
    if (!Number.isInteger(data.priceCents) || data.priceCents < 1) throw new Error("Precio inválido");
    if (typeof data.origin !== "string" || !data.origin) throw new Error("origin requerido");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ paymentUrl: string; orderId: string }> => {
    const origin = validateOrigin(data.origin);
    const { supabase, userId, claims } = context;

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, price_cents, stock, active")
      .eq("id", data.productId)
      .single();

    if (productError || !product) throw new Error("Producto no encontrado");
    if (!product.active) throw new Error("Producto no disponible");
    if (product.stock < data.qty) throw new Error("No hay suficiente inventario");

    const email = await ensureProfileEmail(supabase, userId, claims?.email);
    const ref = externalRef();
    const amountCents = product.price_cents * data.qty;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: orderError } = await (supabaseAdmin.from as any)("clip_orders")
      .insert({
        kind: "merch",
        user_id: userId,
        product_id: product.id,
        qty: data.qty,
        amount_cents: amountCents,
        currency: "MXN",
        description: `${product.name} x${data.qty}`,
        external_ref: ref,
        metadata: { email },
      })
      .select()
      .single();

    if (orderError || !order) throw new Error("No se pudo crear la orden de pago");

    try {
      const link = await createClipPaymentLink({
        amount: amountCents,
        currency: "MXN",
        purchaseDescription: `Läätu — ${product.name} x${data.qty}`,
        successUrl: `${origin}/checkout/return?clip_order_id=${order.id}`,
        errorUrl: `${origin}/checkout/return?clip_order_id=${order.id}&error=1`,
        defaultUrl: `${origin}/checkout/return?clip_order_id=${order.id}`,
        webhookUrl: clipWebhookUrl(origin),
        metadata: {
          kind: "merch",
          product_id: product.id,
          user_id: userId,
          qty: String(data.qty),
          external_ref: ref,
        },
        expiresAt: expireAt(),
      });

      await (supabaseAdmin.from as any)("clip_orders")
        .update({
          payment_request_id: link.paymentRequestId,
          status: mapClipStatus(link.status),
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      return { paymentUrl: link.paymentRequestUrl, orderId: order.id };
    } catch (error) {
      await (supabaseAdmin.from as any)("clip_orders")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", order.id);
      throw new Error(getClipErrorMessage(error));
    }
  });

export const createMerchCartClipCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: MerchCartCheckoutInput) => {
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 20) {
      throw new Error("Carrito inválido");
    }
    for (const it of data.items) {
      if (!/^[a-f0-9-]{36}$/i.test(it.productId)) throw new Error("productId inválido");
      if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 50) throw new Error("Cantidad inválida");
      if (!Number.isInteger(it.priceCents) || it.priceCents < 1) throw new Error("Precio inválido");
    }
    if (typeof data.origin !== "string" || !data.origin) throw new Error("origin requerido");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ paymentUrl: string; orderId: string }> => {
    const origin = validateOrigin(data.origin);
    const { supabase, userId, claims } = context;

    const productIds = data.items.map((it) => it.productId);
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price_cents, stock, active")
      .in("id", productIds);

    if (productsError) throw new Error("No se pudieron validar los productos");

    const byId = new Map(products?.map((p) => [p.id, p]));
    let amountCents = 0;
    const orderItems: { product_id: string; qty: number }[] = [];
    const names: string[] = [];

    for (const it of data.items) {
      const p = byId.get(it.productId);
      if (!p || !p.active) throw new Error(`Producto no disponible: ${it.productName}`);
      if (p.stock < it.qty) throw new Error(`No hay suficiente inventario: ${p.name}`);
      amountCents += p.price_cents * it.qty;
      orderItems.push({ product_id: p.id, qty: it.qty });
      names.push(`${p.name} x${it.qty}`);
    }

    const email = await ensureProfileEmail(supabase, userId, claims?.email);
    const ref = externalRef();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: orderError } = await (supabaseAdmin.from as any)("clip_orders")
      .insert({
        kind: "merch_cart",
        user_id: userId,
        items: orderItems,
        amount_cents: amountCents,
        currency: "MXN",
        description: names.join(", ").slice(0, 150),
        external_ref: ref,
        metadata: { email },
      })
      .select()
      .single();

    if (orderError || !order) throw new Error("No se pudo crear la orden de pago");

    try {
      const link = await createClipPaymentLink({
        amount: amountCents,
        currency: "MXN",
        purchaseDescription: `Läätu — ${names.join(", ").slice(0, 150)}`,
        successUrl: `${origin}/checkout/return?clip_order_id=${order.id}`,
        errorUrl: `${origin}/checkout/return?clip_order_id=${order.id}&error=1`,
        defaultUrl: `${origin}/checkout/return?clip_order_id=${order.id}`,
        webhookUrl: clipWebhookUrl(origin),
        metadata: {
          kind: "merch_cart",
          user_id: userId,
          external_ref: ref,
        },
        expiresAt: expireAt(),
      });

      await (supabaseAdmin.from as any)("clip_orders")
        .update({
          payment_request_id: link.paymentRequestId,
          status: mapClipStatus(link.status),
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      return { paymentUrl: link.paymentRequestUrl, orderId: order.id };
    } catch (error) {
      await (supabaseAdmin.from as any)("clip_orders")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", order.id);
      throw new Error(getClipErrorMessage(error));
    }
  });

export const getClipOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => {
    if (!/^[a-f0-9-]{36}$/i.test(data.orderId)) throw new Error("orderId inválido");
    return data;
  })
  .handler(
    async ({ data, context }): Promise<{ status: string; fulfilled: boolean }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: order, error } = await (supabaseAdmin.from as any)("clip_orders")
        .select("*")
        .eq("id", data.orderId)
        .maybeSingle();

      if (error || !order) throw new Error("Orden no encontrada");
      if (order.user_id !== context.userId) throw new Error("No autorizado");

      if (order.fulfilled) {
        return { status: order.status, fulfilled: true };
      }

      if (!order.payment_request_id) {
        return { status: order.status, fulfilled: false };
      }

      const status = await getClipPaymentStatus(order.payment_request_id);
      const completed = isClipPaymentCompleted(status.status);
      const now = new Date().toISOString();

      if (completed && !order.fulfilled) {
        await fulfillClipOrder(supabaseAdmin, order);
        await (supabaseAdmin.from as any)("clip_orders")
          .update({ status: mapClipStatus(status.status), fulfilled: true, updated_at: now })
          .eq("id", order.id);
        return { status: mapClipStatus(status.status), fulfilled: true };
      }

      await (supabaseAdmin.from as any)("clip_orders")
        .update({ status: mapClipStatus(status.status), updated_at: now })
        .eq("id", order.id);

      return { status: mapClipStatus(status.status), fulfilled: order.fulfilled };
    },
  );

function mapClipStatus(status: string): string {
  const s = String(status).toLowerCase();
  if (s.includes("created")) return "created";
  if (s.includes("pending")) return "pending";
  if (s.includes("completed")) return "completed";
  if (s.includes("cancel")) return "canceled";
  if (s.includes("expire")) return "expired";
  return s;
}

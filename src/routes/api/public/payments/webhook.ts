import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, createStripeClient, verifyWebhook } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _supabase;
}

async function fulfill(params: { userId?: string; planId?: string; externalRef: string }) {
  if (!params.userId || !params.planId) {
    console.error("Webhook sin userId/planId en metadata", params);
    return;
  }
  const { error } = await (getSupabase().rpc as any)("fulfill_plan_purchase", {
    _user_id: params.userId,
    _plan_id: params.planId,
    _external_ref: params.externalRef,
    _payment_method: "tarjeta",
  });
  if (error) console.error("fulfill_plan_purchase failed", error);
}

async function fulfillMerch(params: {
  userId?: string;
  productId?: string;
  qty?: string;
  externalRef: string;
}) {
  if (!params.userId || !params.productId) {
    console.error("Webhook de merch sin userId/productId en metadata", params);
    return;
  }
  const { error } = await (getSupabase().rpc as any)("fulfill_merch_order", {
    _user_id: params.userId,
    _product_id: params.productId,
    _qty: Number(params.qty ?? "1"),
    _external_ref: params.externalRef,
  });
  if (error) console.error("fulfill_merch_order failed", error);
}

async function fulfillMerchCart(params: {
  userId?: string;
  itemsJson?: string;
  externalRef: string;
}) {
  if (!params.userId || !params.itemsJson) {
    console.error("Webhook de merch_cart sin userId/items en metadata", params);
    return;
  }
  let items: unknown;
  try {
    items = JSON.parse(params.itemsJson);
  } catch {
    console.error("Webhook de merch_cart con items invalidos", params.itemsJson);
    return;
  }
  const { error } = await (getSupabase().rpc as any)("fulfill_merch_cart_order", {
    _user_id: params.userId,
    _items: items,
    _external_ref: params.externalRef,
  });
  if (error) console.error("fulfill_merch_cart_order failed", error);
}

// La clienta guardó su tarjeta desde su perfil (Checkout en modo setup).
// Solo guardamos los identificadores del proveedor, nunca datos de la tarjeta.
async function saveCardFromSetup(session: any, env: StripeEnv) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("card_setup sin userId en metadata");
    return;
  }
  const setupIntentId =
    typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!setupIntentId || !customerId) {
    console.error("card_setup sin setup_intent o customer", session.id);
    return;
  }
  const stripe = createStripeClient(env);
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;
  if (!paymentMethodId) {
    console.error("card_setup sin payment_method", session.id);
    return;
  }
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "saved_cards" no está en los tipos generados de este cliente sin genérico
  const { error } = await (getSupabase().from as any)("saved_cards").upsert({
    user_id: userId,
    provider: "stripe",
    customer_id: customerId,
    payment_method_id: paymentMethodId,
    brand: paymentMethod.card?.brand ?? "",
    last4: paymentMethod.card?.last4 ?? "",
    auto_renew: true,
    // "Cambiar tarjeta" no trae plan: se conserva el que ya había elegido.
    ...(session.metadata?.renewalPlanId ? { renewal_plan_id: session.metadata.renewalPlanId } : {}),
    stripe_env: env,
    consent_accepted_at: session.metadata?.consent_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("saved_cards upsert failed", error);
    return;
  }
  // Si la registró al elegir el cobro automático de una membresía, esa
  // membresía queda activada (puede tener varias; se manejan en auto_renewals).
  const renewalPlanId = session.metadata?.renewalPlanId;
  if (renewalPlanId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nueva, cliente sin tipos
    const { error: renewError } = await (getSupabase().rpc as any)("enable_auto_renewal_for", {
      _user_id: userId,
      _plan_id: renewalPlanId,
    });
    if (renewError) console.error("enable_auto_renewal_for failed", userId, renewError);
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.metadata?.kind === "card_setup") {
        await saveCardFromSetup(session, env);
      } else if (session.payment_status !== "unpaid") {
        if (session.metadata?.kind === "merch") {
          await fulfillMerch({
            userId: session.metadata?.userId,
            productId: session.metadata?.productId,
            qty: session.metadata?.qty,
            externalRef: `session_${session.id}`,
          });
        } else if (session.metadata?.kind === "merch_cart") {
          await fulfillMerchCart({
            userId: session.metadata?.userId,
            itemsJson: session.metadata?.items,
            externalRef: `session_${session.id}`,
          });
        } else {
          await fulfill({
            userId: session.metadata?.userId,
            planId: session.metadata?.planId,
            externalRef: `session_${session.id}`,
          });
        }
      }
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      await fulfill({
        userId: session.metadata?.userId,
        planId: session.metadata?.planId,
        externalRef: `session_${session.id}`,
      });
      break;
    }
    case "invoice.paid": {
      // Renovaciones de membresía: acredita créditos en cada ciclo pagado.
      const invoice = event.data.object;
      const line = invoice.lines?.data?.[0];
      const metadata = line?.metadata ?? invoice.subscription_details?.metadata ?? {};
      if (invoice.billing_reason === "subscription_cycle") {
        await fulfill({
          userId: metadata.userId,
          planId: metadata.planId,
          externalRef: `invoice_${invoice.id}`,
        });
      }
      break;
    }
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook con env inválido:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv as StripeEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});

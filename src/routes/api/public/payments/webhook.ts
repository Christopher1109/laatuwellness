import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

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

async function fulfill(params: {
  userId?: string;
  planId?: string;
  externalRef: string;
}) {
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

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.payment_status !== "unpaid") {
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

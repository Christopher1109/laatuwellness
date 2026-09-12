import { createFileRoute } from "@tanstack/react-router";
import {
  getClipPaymentStatus,
  fulfillClipOrder,
  isClipPaymentCompleted,
} from "@/lib/clip.server";

function mapClipStatus(status: string): string {
  const s = String(status).toLowerCase();
  if (s.includes("created")) return "created";
  if (s.includes("pending")) return "pending";
  if (s.includes("completed")) return "completed";
  if (s.includes("cancel")) return "canceled";
  if (s.includes("expire")) return "expired";
  return s;
}

export const Route = createFileRoute("/api/public/clip/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token || token !== process.env["CLIP_WEBHOOK_SECRET"]) {
          console.error("[Clip webhook] token inválido");
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const paymentRequestId =
          (payload["payment_request_id"] as string | undefined) ||
          (payload["checkout_id"] as string | undefined) ||
          (payload["id"] as string | undefined);

        const status =
          (payload["status"] as string | undefined) ||
          (payload["resource_status"] as string | undefined) ||
          (payload["payment_status"] as string | undefined);

        if (!paymentRequestId) {
          console.error("[Clip webhook] sin payment_request_id", payload);
          return new Response("Missing payment_request_id", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: order, error: orderError } = await (supabaseAdmin.from as any)("clip_orders")
          .select("*")
          .eq("payment_request_id", paymentRequestId)
          .maybeSingle();

        if (orderError || !order) {
          console.error("[Clip webhook] orden no encontrada", paymentRequestId, orderError);
          return new Response("Order not found", { status: 200 });
        }

        if (order.fulfilled) {
          return Response.json({ received: true, fulfilled: true });
        }

        try {
          const current = await getClipPaymentStatus(paymentRequestId);
          const currentStatus = mapClipStatus(current.status);

          if (!isClipPaymentCompleted(current.status)) {
            await (supabaseAdmin.from as any)("clip_orders")
              .update({
                status: currentStatus,
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);
            return Response.json({ received: true, status: currentStatus });
          }

          await fulfillClipOrder(supabaseAdmin, order);
          await (supabaseAdmin.from as any)("clip_orders")
            .update({
              status: "completed",
              fulfilled: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          return Response.json({ received: true, fulfilled: true });
        } catch (error) {
          console.error("[Clip webhook] error procesando orden", order.id, error);
          return new Response("Processing error", { status: 500 });
        }
      },
    },
  },
});

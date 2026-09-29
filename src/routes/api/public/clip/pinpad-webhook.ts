import { createFileRoute } from "@tanstack/react-router";
import { syncTerminalPayment } from "@/lib/pos-terminal.server";

// Webhook de la API de PinPad de Clip. Clip solo manda el id del cobro
// ({ id, origin, event_type: "PINPAD_INTENT_STATUS_CHANGED" }), sin el
// resultado, así que aquí siempre se consulta el estado real a Clip antes
// de registrar la venta. Eso también evita que alguien falsifique un "pagado".
export const Route = createFileRoute("/api/public/clip/pinpad-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token || token !== process.env["CLIP_WEBHOOK_SECRET"]) {
          console.error("[Clip PinPad webhook] token inválido");
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const pinpadRequestId =
          (payload["id"] as string | undefined) ||
          (payload["pinpad_request_id"] as string | undefined);
        if (!pinpadRequestId) {
          console.error("[Clip PinPad webhook] sin id", payload);
          return new Response("Missing id", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla nueva, aún no está en los tipos generados
        const admin = supabaseAdmin as any;

        const { data: row, error } = await admin
          .from("pos_terminal_payments")
          .select("id, brand, status, pinpad_request_id, amount_cents, sale_id, error, card_last4")
          .eq("pinpad_request_id", pinpadRequestId)
          .maybeSingle();

        if (error || !row) {
          // 200 para que Clip no reintente algo que no es nuestro.
          console.error("[Clip PinPad webhook] cobro no encontrado", pinpadRequestId, error);
          return Response.json({ received: true, found: false });
        }

        try {
          const synced = await syncTerminalPayment(admin, row);
          return Response.json({ received: true, status: synced.status });
        } catch (err) {
          console.error("[Clip PinPad webhook] error procesando", row.id, err);
          // 500 para que Clip reintente más tarde.
          return new Response("Processing error", { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Webhook de Wellhub: cuando alguien reserva o cancela una clase desde la
// app de Wellhub, ellos mandan un POST aquí. Hay que responder en menos de
// 15 minutos o Wellhub rechaza la reserva automáticamente — por eso todo
// esto es síncrono, sin colas ni reintentos propios.
//
// IMPORTANTE — pendiente de confirmar con el equipo de integraciones de
// Wellhub (integrations@gympass.com) una vez que Läätu tenga acceso de
// partner:
//   1. El esquema exacto de autenticación del webhook (aquí se usa un
//      bearer token simple contra WELLHUB_WEBHOOK_SECRET; Wellhub podría
//      usar HMAC de firma en vez de esto — ajustar cuando llegue su doc).
//   2. La forma exacta del payload (los nombres de campo de abajo son la
//      mejor estimación según su documentación pública; hay que validarlos
//      contra un payload real de prueba antes de dejarlo en producción).
// ============================================================================

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

type WellhubBookingEvent = {
  type: "booking.created" | "booking.cancelled" | string;
  booking_id: string;
  class_id: string; // nuestro id de public.classes, mandado al crear el slot
  member?: { name?: string; email?: string };
};

export const Route = createFileRoute("/api/public/wellhub/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const expected = `Bearer ${process.env["WELLHUB_WEBHOOK_SECRET"] ?? ""}`;
        if (!process.env["WELLHUB_WEBHOOK_SECRET"] || auth !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let event: WellhubBookingEvent;
        try {
          event = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const supabase = getSupabase();

        if (event.type === "booking.created") {
          const { data, error } = await (supabase.rpc as any)("fulfill_wellhub_booking", {
            _class_id: event.class_id,
            _wellhub_booking_id: event.booking_id,
            _member_name: event.member?.name ?? null,
            _member_email: event.member?.email ?? null,
          });
          if (error) {
            console.error("fulfill_wellhub_booking failed", error);
            return new Response("Error interno", { status: 500 });
          }
          const accepted = Array.isArray(data) ? data[0]?.accepted : data?.accepted;
          // El status HTTP le indica a Wellhub si la reserva se aceptó o si
          // ya no había cupo (deberían dejar de ofrecerlo si esto pasa
          // seguido — quiere decir que wellhub_max_spots está muy alto).
          return new Response(null, { status: accepted ? 200 : 409 });
        }

        if (event.type === "booking.cancelled") {
          const { error } = await (supabase.rpc as any)("cancel_wellhub_booking", {
            _wellhub_booking_id: event.booking_id,
          });
          if (error) {
            console.error("cancel_wellhub_booking failed", error);
            return new Response("Error interno", { status: 500 });
          }
          return new Response(null, { status: 200 });
        }

        // Tipo de evento que no reconocemos todavía — se acepta para no
        // generar reintentos infinitos, pero se deja registro.
        console.warn("Evento de Wellhub sin manejar:", event.type);
        return new Response(null, { status: 200 });
      },
    },
  },
});

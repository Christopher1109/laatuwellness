import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { StripeEnv } from "@/lib/stripe.server";
import { chargeRenewal, findDueRenewals } from "@/lib/renewals.server";

// Corre las renovaciones de membresía vencidas con tarjeta guardada. Ruta
// pública solo en URL: exige el secreto de cron (o la service key) en el
// header Authorization, así que un llamado externo sin credencial no hace nada.
export const Route = createFileRoute("/api/public/renewals/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const cronSecret = process.env["LOVABLE_CRON_SECRET"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        const authorized =
          (cronSecret && auth === `Bearer ${cronSecret}`) ||
          (serviceKey && auth === `Bearer ${serviceKey}`);
        if (!authorized) return new Response("Forbidden", { status: 403 });

        const rawEnv = new URL(request.url).searchParams.get("env");
        const env: StripeEnv = rawEnv === "live" ? "live" : "sandbox";

        const admin = createClient(process.env["SUPABASE_URL"]!, serviceKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        try {
          const due = await findDueRenewals(admin);
          const results: { user_id: string; charged: boolean; error?: string }[] = [];
          for (const renewal of due) {
            const result = await chargeRenewal(admin, env, renewal);
            results.push({ user_id: renewal.user_id, ...result });
          }
          return Response.json({ processed: results.length, results });
        } catch (error) {
          console.error("Renewals run error:", error);
          return new Response("Renewals error", { status: 500 });
        }
      },
    },
  },
});

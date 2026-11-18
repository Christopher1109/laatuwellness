import { createFileRoute } from "@tanstack/react-router";
import { chargeRenewal, findDueRenewals } from "@/lib/renewals.server";
import { isScheduledRequestAuthorized, scheduledAdminClient } from "@/lib/scheduled-auth.server";

// Cobra las renovaciones con tarjeta guardada que vencen hoy. La llama una
// tarea programada (pg_cron) todos los días; sin credencial no hace nada.
export const Route = createFileRoute("/api/public/renewals/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = scheduledAdminClient();
        if (!(await isScheduledRequestAuthorized(request, admin))) {
          return new Response("Forbidden", { status: 403 });
        }
        try {
          const due = await findDueRenewals(admin);
          const results: { user_id: string; charged: boolean; error?: string }[] = [];
          for (const renewal of due) {
            const result = await chargeRenewal(admin, renewal);
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

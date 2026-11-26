import { createFileRoute } from "@tanstack/react-router";
import { type ReminderRow, buildReminderEmail } from "@/lib/membership-emails";
import { isScheduledRequestAuthorized, scheduledAdminClient } from "@/lib/scheduled-auth.server";

// Manda por correo (Resend) el aviso de que la membresía termina en 10 días o
// menos. Una vez por clienta y periodo (membership_reminders). La llama una
// tarea programada (pg_cron) todos los días.
export const Route = createFileRoute("/api/public/reminders/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = scheduledAdminClient();
        if (!(await isScheduledRequestAuthorized(request, admin))) {
          return new Response("Forbidden", { status: 403 });
        }
        const apiKey = process.env["RESEND_API_KEY"];
        if (!apiKey) return new Response("RESEND_API_KEY no configurada", { status: 500 });
        const from = process.env["RESEND_FROM"] ?? "LAATU WELLNESS <hola@laatuwellness.com>";
        const replyTo = process.env["RESEND_REPLY_TO"] ?? "lore@laatuwellness.com";
        const params = new URL(request.url).searchParams;
        const dryRun = params.get("dry") === "1";

        // Prueba: manda las 3 plantillas a un correo dado, sin tocar a clientas
        // ni registrar nada. Solo con la credencial de las tareas programadas.
        const testTo = params.get("test_to");
        if (testTo) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) {
            return new Response("Correo inválido", { status: 400 });
          }
          const sample: ReminderRow = {
            user_id: "test",
            email: testTo,
            full_name: "Prueba",
            plan_name: "Founders Access",
            ends_at: new Date(Date.now() + 10 * 86400000).toISOString(),
            is_founders: true,
            auto_renew_plan: null,
          };
          const variants: ReminderRow[] = [
            sample,
            { ...sample, is_founders: false, plan_name: "The Everyday" },
            { ...sample, auto_renew_plan: "Founders Access · Mensual recurrente" },
          ];
          const sent: { template: string; status: number; detail?: string }[] = [];
          for (const row of variants) {
            const email = buildReminderEmail(row);
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from,
                to: [testTo],
                reply_to: replyTo,
                subject: `[PRUEBA] ${email.subject}`,
                html: email.html,
                text: email.text,
              }),
            });
            sent.push({
              template: email.template,
              status: res.status,
              ...(res.ok ? {} : { detail: (await res.text()).slice(0, 300) }),
            });
          }
          return Response.json({ test: true, sent });
        }

        const { data, error } = await admin.rpc("due_membership_reminders");
        if (error) {
          console.error("due_membership_reminders", error);
          return new Response("Reminders error", { status: 500 });
        }
        const rows = (data ?? []) as ReminderRow[];
        const results: { user_id: string; sent: boolean; error?: string }[] = [];
        for (const row of rows) {
          const email = buildReminderEmail(row);
          if (dryRun) {
            results.push({
              user_id: row.user_id,
              sent: false,
              error: `dry-run: ${email.template}`,
            });
            continue;
          }
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from,
              to: [row.email],
              reply_to: replyTo,
              subject: email.subject,
              html: email.html,
              text: email.text,
            }),
          });
          if (!res.ok) {
            const detail = await res.text();
            console.error("Resend error", row.user_id, res.status, detail);
            results.push({ user_id: row.user_id, sent: false, error: `${res.status}` });
            continue;
          }
          await admin.from("membership_reminders").insert({
            user_id: row.user_id,
            cycle_end: row.ends_at,
            template: email.template,
            family_id: row.family_id ?? null,
          });
          results.push({ user_id: row.user_id, sent: true });
        }
        return Response.json({ processed: rows.length, results });
      },
    },
  },
});

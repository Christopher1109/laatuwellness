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
        const dryRun = new URL(request.url).searchParams.get("dry") === "1";

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
            results.push({ user_id: row.user_id, sent: false, error: `dry-run: ${email.template}` });
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
          });
          results.push({ user_id: row.user_id, sent: true });
        }
        return Response.json({ processed: rows.length, results });
      },
    },
  },
});

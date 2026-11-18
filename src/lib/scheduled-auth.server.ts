import { type SupabaseClient, createClient } from "@supabase/supabase-js";

// Rutas que corren las tareas programadas (pg_cron → pg_net). Aceptan el
// secreto guardado en public.cron_secrets (solo legible con service role),
// el secreto de cron de Lovable o la service key.
export function scheduledAdminClient(): SupabaseClient {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function isScheduledRequestAuthorized(
  request: Request,
  admin: SupabaseClient,
): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length < 20) return false;
  const token = auth.slice("Bearer ".length);
  const cronSecret = process.env["LOVABLE_CRON_SECRET"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if ((cronSecret && token === cronSecret) || (serviceKey && token === serviceKey)) return true;
  const { data } = await admin
    .from("cron_secrets")
    .select("secret")
    .eq("name", "scheduled_jobs")
    .maybeSingle();
  return Boolean(data?.secret && token === data.secret);
}

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cashChangeCents } from "@/lib/profile-checkout";
import { describeError } from "@/lib/describe-error";

export const collectProfileCash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId: string; planId: string; receivedCents: number }) => {
    const uuid = /^[a-f0-9-]{36}$/i;
    if (!uuid.test(data.clientId) || !uuid.test(data.planId)) throw new Error("Compra inválida.");
    cashChangeCents(0, data.receivedCents);
    return data;
  })
  .handler(async ({ data, context }) => {
    const [{ data: admin }, { data: staff }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("is_staff", { _user_id: context.userId }),
    ]);
    if (!admin && !staff) throw new Error("No tienes permiso para registrar ventas.");
    const { data: plan, error } = await context.supabase.from("token_plans")
      .select("price_cents").eq("id", data.planId).eq("active", true).single();
    if (error || !plan) throw new Error("Este paquete ya no está disponible.");
    const changeCents = cashChangeCents(plan.price_cents, data.receivedCents);
    const { error: saleError } = await context.supabase.rpc("pos_sell_plans_cash", {
      _user_id: data.clientId,
      _plans: [{ plan_id: data.planId, qty: 1 }],
    });
    if (saleError) throw new Error(describeError(saleError, "No se pudo registrar la compra."));
    return { changeCents };
  });
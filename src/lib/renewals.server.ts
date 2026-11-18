import type { SupabaseClient } from "@supabase/supabase-js";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

// Renovación automática de membresías con tarjeta guardada. Los cobros se
// hacen off-session del lado del servidor; al fallar, la clienta queda con un
// cargo pendiente que bloquea sus reservas hasta que pague.

export type DueRenewal = {
  user_id: string;
  plan_id: string;
  renewal_plan_id: string;
  plan_name: string;
  amount_cents: number;
  customer_id: string;
  payment_method_id: string;
  ends_at: string;
};

export async function findDueRenewals(
  admin: SupabaseClient,
  userId?: string,
): Promise<DueRenewal[]> {
  const { data, error } = await admin.rpc("due_renewals");
  if (error) throw error;
  const rows = (data ?? []) as DueRenewal[];
  return userId ? rows.filter((r) => r.user_id === userId) : rows;
}

export async function chargeRenewal(
  admin: SupabaseClient,
  env: StripeEnv,
  renewal: DueRenewal,
): Promise<{ charged: boolean; error?: string }> {
  const stripe = createStripeClient(env);
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: renewal.amount_cents,
      currency: "mxn",
      customer: renewal.customer_id,
      payment_method: renewal.payment_method_id,
      off_session: true,
      confirm: true,
      description: `Renovación ${renewal.plan_name} — Läätu Wellness`,
    });
    const { error } = await admin.rpc("fulfill_plan_purchase", {
      _user_id: renewal.user_id,
      _plan_id: renewal.renewal_plan_id,
      _external_ref: `renewal_${paymentIntent.id}`,
      _payment_method: "tarjeta (renovación automática)",
    });
    if (error) return { charged: false, error: error.message };
    return { charged: true };
  } catch (error) {
    // "Vencida – pago pendiente": el cargo pendiente bloquea sus reservas
    // hasta que lo pague (mismo mecanismo que las multas por faltas).
    await admin.from("membership_fees").insert({
      user_id: renewal.user_id,
      amount_cents: renewal.amount_cents,
      reason: `Renovación automática fallida — ${renewal.plan_name}`,
      status: "pending_charge",
    });
    return { charged: false, error: getStripeErrorMessage(error) };
  }
}

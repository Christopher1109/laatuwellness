import type { SupabaseClient } from "@supabase/supabase-js";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

// Renovación automática con tarjeta guardada: solo el plan que la clienta
// eligió (p. ej. Founders mensual). Se cobra off-session del lado del
// servidor el último día del periodo. Si falla, queda UN cargo pendiente por
// ciclo (índice único) que bloquea sus reservas; al pagarlo (en línea o en
// recepción) se activa el nuevo periodo.

export type DueRenewal = {
  user_id: string;
  plan_id: string;
  renewal_plan_id: string;
  plan_name: string;
  amount_cents: number;
  customer_id: string;
  payment_method_id: string;
  ends_at: string;
  stripe_env: string;
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

export function renewalEnv(renewal: Pick<DueRenewal, "stripe_env">): StripeEnv {
  return renewal.stripe_env === "sandbox" ? "sandbox" : "live";
}

export async function chargeRenewal(
  admin: SupabaseClient,
  renewal: DueRenewal,
): Promise<{ charged: boolean; error?: string }> {
  const stripe = createStripeClient(renewalEnv(renewal));
  // Referencia estable por ciclo: si se reintenta, fulfill_plan_purchase no
  // crea un segundo periodo.
  const externalRef = `renewal_${renewal.user_id}_${new Date(renewal.ends_at).getTime()}`;
  let paymentIntentId: string;
  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: renewal.amount_cents,
        currency: "mxn",
        customer: renewal.customer_id,
        payment_method: renewal.payment_method_id,
        off_session: true,
        confirm: true,
        description: `Renovación ${renewal.plan_name} — Läätu Wellness`,
      },
      { idempotencyKey: externalRef },
    );
    paymentIntentId = paymentIntent.id;
  } catch (error) {
    // "Vencida – pago pendiente": un solo cargo pendiente por ciclo.
    await admin.from("membership_fees").upsert(
      {
        user_id: renewal.user_id,
        amount_cents: renewal.amount_cents,
        reason: `Renovación automática fallida — ${renewal.plan_name}`,
        status: "pending_charge",
        kind: "renovacion",
        renewal_plan_id: renewal.renewal_plan_id,
        cycle_end: renewal.ends_at,
      },
      { onConflict: "user_id,cycle_end", ignoreDuplicates: true },
    );
    return { charged: false, error: getStripeErrorMessage(error) };
  }

  const { error } = await admin.rpc("fulfill_plan_purchase", {
    _user_id: renewal.user_id,
    _plan_id: renewal.renewal_plan_id,
    _external_ref: externalRef,
    _payment_method: "tarjeta (renovación automática)",
  });
  // Registro del cobro del ciclo (evita volver a cobrar aunque falle lo demás).
  await admin.from("membership_fees").insert({
    user_id: renewal.user_id,
    amount_cents: renewal.amount_cents,
    reason: `Renovación automática — ${renewal.plan_name} (${paymentIntentId})`,
    status: "charged",
    charged_at: new Date().toISOString(),
    kind: "renovacion",
    renewal_plan_id: renewal.renewal_plan_id,
    cycle_end: renewal.ends_at,
    paid_method: "tarjeta",
  });
  if (error) {
    console.error("Renovación cobrada pero no activada", renewal.user_id, paymentIntentId, error);
    return { charged: true, error: error.message };
  }
  return { charged: true };
}

/** Después de cobrar un cargo pendiente: si era una renovación, activa el periodo. */
export async function activateRenewalFee(
  admin: SupabaseClient,
  fee: { id: string; user_id: string; kind?: string | null; renewal_plan_id?: string | null },
): Promise<void> {
  if (fee.kind !== "renovacion" || !fee.renewal_plan_id) return;
  const { error } = await admin.rpc("fulfill_plan_purchase", {
    _user_id: fee.user_id,
    _plan_id: fee.renewal_plan_id,
    _external_ref: `fee_${fee.id}`,
    _payment_method: "tarjeta",
  });
  if (error) console.error("No se pudo activar la renovación pagada", fee.id, error);
}

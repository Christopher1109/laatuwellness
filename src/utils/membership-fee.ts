import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment, paymentsConfigured } from "@/lib/stripe";
import { chargeMembershipFee } from "@/utils/payments.functions";

/**
 * Se llama después de cancel_booking / mark_no_show. Si esa acción generó un
 * fee de membresía pendiente para esta reserva, intenta cobrarlo de inmediato
 * contra la tarjeta guardada del cliente en Stripe. Si el cliente no tiene
 * membresía activa, o canceló a tiempo, simplemente no hay nada que cobrar y
 * esta función no hace ni dice nada.
 */
export async function tryChargePendingNoShowFee(bookingId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "membership_fees" no está en los tipos generados
  const { data: fee } = await (supabase.from as any)("membership_fees")
    .select("id, amount_cents")
    .eq("booking_id", bookingId)
    .eq("status", "pending_charge")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fee) return;

  if (!paymentsConfigured()) {
    toast.warning(
      "Se generó un cargo de $150 pendiente, pero los pagos en línea no están configurados todavía. Cóbralo manualmente.",
    );
    return;
  }

  const result = await chargeMembershipFee({
    data: { membershipFeeId: fee.id, environment: getStripeEnvironment() },
  });

  if (result.charged) {
    toast.success(
      `Se cobraron $${(fee.amount_cents / 100).toFixed(0)} MXN de fee por no-show/cancelación tardía.`,
    );
  } else {
    toast.warning(
      `No se pudo cobrar el fee de $${(fee.amount_cents / 100).toFixed(0)} MXN automáticamente (${result.error ?? "error desconocido"}). Queda pendiente, cóbralo manualmente.`,
    );
  }
}

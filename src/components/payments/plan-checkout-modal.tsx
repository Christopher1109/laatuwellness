import { useState } from "react";
import { toast } from "sonner";
import { createPlanClipCheckout } from "@/utils/clip.functions";
import { supabase } from "@/integrations/supabase/client";

export interface CheckoutPlan {
  id: string;
  name: string;
  price_cents: number;
  tokens: number;
  currency?: string;
  stripe_price_id?: string | null;
  recurring?: boolean;
}

export function planPriceId(plan: {
  stripe_price_id?: string | null;
}): string {
  return (plan.stripe_price_id ?? "").trim();
}

function money(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

interface PlanCheckoutModalProps {
  plan: CheckoutPlan;
  user?: { id?: string; email?: string } | null;
  onClose: () => void;
}

export function PlanCheckoutModal({ plan, user, onClose }: PlanCheckoutModalProps) {
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const handlePay = async () => {
    if (!user?.id) {
      toast.error("Inicia sesión para comprar.");
      return;
    }
    setLoading(true);
    try {
      const result = await createPlanClipCheckout({
        data: { planId: plan.id, origin: window.location.origin },
      });
      if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
      } else {
        throw new Error("Clip no devolvió un link de pago.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el pago.");
      setLoading(false);
    }
  };

  const handleRequestMembership = async () => {
    if (!user?.id) {
      toast.error("Inicia sesión para continuar.");
      return;
    }
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- membership_requests no está en los tipos generados todavía
      const { error } = await (supabase.from as any)("membership_requests").insert({
        user_id: user.id,
        plan_id: plan.id,
      });
      if (error) throw error;
      setRequested(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo enviar tu solicitud.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow text-[0.6rem]">
              {plan.recurring ? "Membresía" : "Pago seguro con Clip"}
            </p>
            <h3 className="mt-1 truncate text-base font-medium">
              {plan.name} · {money(plan.price_cents, plan.currency ?? "MXN")}
              {plan.recurring ? " / mes" : ""}
            </h3>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              {plan.tokens} {plan.tokens === 1 ? "crédito" : "créditos"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 border border-input px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.16em]"
          >
            Cerrar
          </button>
        </div>
        <div className="p-4 sm:p-6">
          {plan.recurring ? (
            requested ? (
              <p className="text-sm text-muted-foreground">
                ¡Listo! Un miembro del equipo te va a contactar en las próximas horas para
                completar tu inscripción y activar el cobro automático mensual.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Las membresías se inscriben directamente contigo para activar el cobro
                  automático mensual. Envía tu solicitud y el equipo de Läätu te contacta para
                  completarla.
                </p>
                <button
                  onClick={handleRequestMembership}
                  disabled={loading}
                  className="mt-5 w-full bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  {loading ? "Enviando…" : "Solicitar membresía"}
                </button>
              </>
            )
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Serás redirigido a Clip para completar tu pago con tarjeta. Al volver,
                tus créditos se acreditarán automáticamente.
              </p>
              <button
                onClick={handlePay}
                disabled={loading}
                className="mt-5 w-full bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {loading ? "Preparando pago…" : "Continuar al pago"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

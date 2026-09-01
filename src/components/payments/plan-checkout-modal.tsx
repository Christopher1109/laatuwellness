import { StripeEmbeddedCheckout } from "@/components/payments/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/payments/PaymentTestModeBanner";

export interface CheckoutPlan {
  id: string;
  name: string;
  price_cents: number;
  tokens: number;
  currency?: string;
  stripe_price_id?: string | null;
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
  const priceId = planPriceId(plan);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl bg-background" onClick={(e) => e.stopPropagation()}>
        <PaymentTestModeBanner />
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="eyebrow">Pago seguro</p>
            <h3 className="mt-2 text-lg">
              {plan.name} · {money(plan.price_cents, plan.currency ?? "MXN")}
            </h3>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {plan.tokens} {plan.tokens === 1 ? "crédito" : "créditos"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="border border-input px-4 py-2 text-[0.66rem] uppercase tracking-[0.16em]"
          >
            Cerrar
          </button>
        </div>
        <div className="p-4 sm:p-6">
          {priceId ? (
            <StripeEmbeddedCheckout
              priceId={priceId}
              planId={plan.id}
              {...(user?.email ? { customerEmail: user.email } : {})}
              {...(user?.id ? { userId: user.id } : {})}
              returnUrl={`${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Este paquete todavía no tiene pago en línea configurado. Escríbenos por WhatsApp
              y lo resolvemos contigo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <PaymentTestModeBanner />
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow text-[0.6rem]">Pago seguro</p>
            <h3 className="mt-1 truncate text-base font-medium">
              {plan.name} · {money(plan.price_cents, plan.currency ?? "MXN")}
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
        <div className="max-h-[70vh] overflow-y-auto p-3 sm:p-4">
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

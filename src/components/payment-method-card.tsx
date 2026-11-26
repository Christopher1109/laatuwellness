import { useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createCardSetupSession } from "@/utils/payments.functions";
import { getStripe, getStripeEnvironment, paymentsConfigured } from "@/lib/stripe";

export type SavedCard = {
  user_id: string;
  brand: string;
  last4: string;
  auto_renew: boolean;
  consent_accepted_at: string;
};

export function useSavedCard(userId: string | undefined) {
  return useQuery({
    queryKey: ["saved-card", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_cards")
        .select("user_id, brand, last4, auto_renew, consent_accepted_at")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as SavedCard | null) ?? null;
    },
  });
}

/** Checkout embebido en modo "setup": registra la tarjeta sin cobrar nada. */
export function CardSetupCheckout({ renewalPlanId }: { renewalPlanId?: string } = {}) {
  const fetchClientSecret = async (): Promise<string> => {
    const result = await createCardSetupSession({
      data: {
        returnUrl: `${window.location.origin}/cuenta?tarjeta=guardada`,
        environment: getStripeEnvironment(),
        consentAccepted: true,
        ...(renewalPlanId ? { renewalPlanId } : {}),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Stripe no devolvió un client secret");
    return result.clientSecret;
  };

  return (
    <div className="max-h-[70vh] min-h-[24rem] overflow-y-auto">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

const CONSENT_TEXT =
  "Acepto que esta tarjeta se use para el cobro automático de las membresías que yo elija (por el monto y periodo de cada una) y para la política de cancelación: puedo cancelar sin costo hasta 12 h antes de la clase; a la 3ª falta se cobra una multa de $150 a esta tarjeta.";

export type AutoRenewalOption = {
  family_id: string;
  plan_name: string;
  ends_at: string;
  active: boolean;
  stripe_subscription: boolean;
  enabled: boolean;
  renew_plan: { id: string; name: string; price_cents: number } | null;
};

/** Membresías de la clienta que se pueden cobrar solas con su tarjeta. */
export function useMyAutoRenewals(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-auto-renewals", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nueva
      const { data, error } = await (supabase.rpc as any)("my_auto_renewals");
      if (error) throw error;
      return ((data ?? []) as AutoRenewalOption[]) ?? [];
    },
  });
}

/** Activa o desactiva el cobro automático de una membresía. */
export function useSetAutoRenewal(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, enabled }: { planId: string; enabled: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nueva
      const { error } = await (supabase.rpc as any)("set_auto_renewal", {
        _plan_id: planId,
        _enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: (_d, { enabled }) => {
      toast.success(
        enabled
          ? "Cobro automático activado."
          : "Cobro automático desactivado. Tu membresía terminará en su fecha de vencimiento.",
      );
      void qc.invalidateQueries({ queryKey: ["my-auto-renewals", userId] });
      void qc.invalidateQueries({ queryKey: ["saved-card", userId] });
      void qc.invalidateQueries({ queryKey: ["renewal-status", userId] });
    },
    onError: (e: { message?: string }) =>
      toast.error(
        e?.message?.includes("CARD_REQUIRED")
          ? "Primero registra una tarjeta."
          : "No se pudo actualizar. Intenta de nuevo.",
      ),
  });
}

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "America/Monterrey",
  }).format(new Date(iso));

/** Lista de membresías con su interruptor de cobro automático. */
function AutoRenewalList({ userId, hasCard }: { userId: string; hasCard: boolean }) {
  const { data: options } = useMyAutoRenewals(userId);
  const setAuto = useSetAutoRenewal(userId);
  if (!options?.length) return null;
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
        Cobro automático
      </p>
      {options.map((o) => (
        <div key={o.family_id} className="text-sm">
          {o.stripe_subscription ? (
            <p>{o.plan_name}: se cobra sola cada mes con tu suscripción.</p>
          ) : o.renew_plan ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={o.enabled}
                disabled={!hasCard || setAuto.isPending}
                onChange={(e) =>
                  setAuto.mutate({ planId: o.renew_plan!.id, enabled: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
              />
              <span>
                Cobrar {o.renew_plan.name} automáticamente — {money(o.renew_plan.price_cents)}
                <span className="block text-xs text-muted-foreground">
                  {o.active
                    ? `Tu ${o.plan_name} termina el ${shortDate(o.ends_at)}; ${
                        o.enabled
                          ? "ese día se cobra la renovación."
                          : "si lo activas, ese día se cobra la renovación."
                      }`
                    : `Tu ${o.plan_name} terminó el ${shortDate(o.ends_at)}.`}
                </span>
              </span>
            </label>
          ) : null}
        </div>
      ))}
      {!hasCard ? (
        <p className="text-xs text-muted-foreground">
          Registra una tarjeta para activar el cobro automático.
        </p>
      ) : null}
    </div>
  );
}

/** Sección "Método de pago" del perfil: tarjeta guardada y cobro automático por membresía. */
export function PaymentMethodCard({ userId }: { userId: string }) {
  const { data: card } = useSavedCard(userId);
  const [consent, setConsent] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  if (!paymentsConfigured()) return null;

  if (settingUp) {
    return (
      <div className="border border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Registrar tarjeta</p>
          <button
            onClick={() => setSettingUp(false)}
            className="border border-input px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.16em]"
          >
            Cancelar
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          No se hace ningún cobro al registrarla. Los datos de tu tarjeta los maneja Stripe de forma
          segura; nosotros solo guardamos una referencia.
        </p>
        <div className="mt-4">
          <CardSetupCheckout />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border p-5">
      <p className="eyebrow">Método de pago</p>
      {card ? (
        <div className="mt-3 space-y-3">
          <p className="text-lg capitalize">
            {card.brand || "Tarjeta"} ···· {card.last4}
          </p>
          <AutoRenewalList userId={userId} hasCard />
          <button
            onClick={() => {
              setConsent(false);
              setSettingUp(true);
            }}
            className="border border-input px-4 py-2 text-[0.65rem] uppercase tracking-[0.16em] hover:border-foreground"
          >
            Cambiar tarjeta
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-muted-foreground">
            Registra una tarjeta para que tus membresías se cobren solas y conserves tu lugar.
          </p>
          <AutoRenewalList userId={userId} hasCard={false} />
          <label className="flex cursor-pointer items-start gap-3 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
            />
            {CONSENT_TEXT}
          </label>
          <button
            onClick={() => setSettingUp(true)}
            disabled={!consent}
            className="bg-foreground px-5 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-40"
          >
            Registrar tarjeta
          </button>
        </div>
      )}
    </div>
  );
}

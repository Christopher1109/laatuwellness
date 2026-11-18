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
export function CardSetupCheckout() {
  const fetchClientSecret = async (): Promise<string> => {
    const result = await createCardSetupSession({
      data: {
        returnUrl: `${window.location.origin}/cuenta?tarjeta=guardada`,
        environment: getStripeEnvironment(),
        consentAccepted: true,
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
  "Acepto el cobro automático de mi membresía en cada renovación y la política de cancelación: puedo cancelar sin costo hasta 12 h antes de la clase; a la 3ª falta se cobra una multa de $150 a esta tarjeta.";

/** Sección "Método de pago" del perfil: tarjeta guardada y renovación automática. */
export function PaymentMethodCard({ userId }: { userId: string }) {
  const { data: card } = useSavedCard(userId);
  const qc = useQueryClient();
  const [consent, setConsent] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  const toggleAutoRenew = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("saved_cards")
        .update({ auto_renew: enabled })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_d, enabled) => {
      toast.success(
        enabled
          ? "Renovación automática activada."
          : "Renovación automática desactivada. Tu membresía terminará en su fecha de vencimiento.",
      );
      void qc.invalidateQueries({ queryKey: ["saved-card", userId] });
      void qc.invalidateQueries({ queryKey: ["renewal-status", userId] });
    },
    onError: () => toast.error("No se pudo actualizar. Intenta de nuevo."),
  });

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
          No se hace ningún cobro al registrarla. Los datos de tu tarjeta los maneja Stripe de
          forma segura; nosotros solo guardamos una referencia.
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
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={card.auto_renew}
              onChange={(e) => toggleAutoRenew.mutate(e.target.checked)}
              disabled={toggleAutoRenew.isPending}
              className="h-4 w-4 accent-foreground"
            />
            Renovar mi membresía automáticamente con esta tarjeta
          </label>
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
            Registra una tarjeta para que tu membresía se renueve sola y conserves tu precio.
          </p>
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

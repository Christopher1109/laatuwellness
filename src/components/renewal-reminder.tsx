import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CardSetupCheckout } from "@/components/payment-method-card";
import { paymentsConfigured } from "@/lib/stripe";

export type RenewalStatus = {
  plan_name: string;
  ends_at: string;
  days_left: number;
  has_card: boolean;
  auto_renew: boolean;
  card_brand: string;
  card_last4: string;
  opted_out: boolean;
  show_modal: boolean;
};

export function useRenewalStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ["renewal-status", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("renewal_status", { _user_id: userId! });
      if (error) throw error;
      return (data as unknown as RenewalStatus | null) ?? null;
    },
  });
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Monterrey" }).format(
    new Date(iso),
  );

/** Pop-up de renovación: membresía a 7 días o menos de vencer sin tarjeta con
 *  cobro automático. "Recordarme después" lo vuelve a mostrar en la próxima
 *  sesión; "No quiero renovar" lo apaga para este ciclo. */
export function RenewalReminder({ userId }: { userId: string | undefined }) {
  const { data } = useRenewalStatus(userId);
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const optOut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("opt_out_renewal");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entendido: tu membresía terminará en su fecha de vencimiento.");
      void qc.invalidateQueries({ queryKey: ["renewal-status", userId] });
    },
    onError: () => toast.error("No se pudo guardar tu decisión."),
  });

  if (!data?.show_modal || dismissed || !paymentsConfigured()) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-label="Renovación de membresía"
    >
      <div className="w-full max-w-md border border-border bg-background p-6 shadow-2xl">
        <p className="eyebrow">Renovación</p>
        <h3 className="statement mt-2 text-2xl">Tu membresía vence el {fmtDate(data.ends_at)}</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Para mantener tu membresía y tu precio, registra una tarjeta para el cobro automático
          mensual. Esta tarjeta también se usará para la política de faltas.
        </p>
        {showSetup ? (
          <div className="mt-4">
            <CardSetupCheckout />
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            <button
              onClick={() => setShowSetup(true)}
              className="w-full bg-foreground px-5 py-3.5 text-[0.7rem] uppercase tracking-[0.16em] text-background"
            >
              Registrar tarjeta
            </button>
            <button
              onClick={() => optOut.mutate()}
              disabled={optOut.isPending}
              className="w-full border border-input px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] hover:border-foreground disabled:opacity-50"
            >
              No quiero renovar
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="w-full px-5 py-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
            >
              Recordarme después
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

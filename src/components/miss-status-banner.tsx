import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { payMyMembershipFee } from "@/utils/payments.functions";
import { getStripeEnvironment, paymentsConfigured } from "@/lib/stripe";

export type MissStatus = {
  count: number;
  free_misses: number;
  fine_cents: number;
  cancel_hours: number;
  pending_fees: { id: string; amount_cents: number; reason: string; created_at: string }[];
  last_charge: { amount_cents: number; charged_at: string; reason: string } | null;
  message: string | null;
};

export function useMissStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ["miss-status", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("miss_status", { _user_id: userId! });
      if (error) throw error;
      return data as unknown as MissStatus;
    },
  });
}

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(
    cents / 100,
  );

/** Avisos de faltas y cargos pendientes: se muestra en Mi cuenta y en la app. */
export function MissStatusBanner({ userId }: { userId: string | undefined }) {
  const { data } = useMissStatus(userId);
  const qc = useQueryClient();

  const pay = useMutation({
    mutationFn: async (feeId: string) => {
      const result = await payMyMembershipFee({
        data: { membershipFeeId: feeId, environment: getStripeEnvironment() },
      });
      if (!result.charged) throw new Error(result.error ?? "No se pudo cobrar.");
    },
    onSuccess: () => {
      toast.success("Cargo pagado. Ya puedes volver a reservar.");
      void qc.invalidateQueries({ queryKey: ["miss-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;
  const pending = data.pending_fees ?? [];
  const recentCharge =
    data.last_charge && Date.now() - new Date(data.last_charge.charged_at).getTime() < 7 * 86400000
      ? data.last_charge
      : null;
  if (!data.message && pending.length === 0 && !recentCharge) return null;

  return (
    <div className="space-y-3">
      {data.message ? (
        <p className="border border-border bg-muted/40 p-4 text-sm">{data.message}</p>
      ) : null}
      {recentCharge ? (
        <p className="border border-border bg-muted/40 p-4 text-sm">
          Se realizó un cargo de {money(recentCharge.amount_cents)} por tu falta acumulada. Tu
          contador de faltas se reinició.
        </p>
      ) : null}
      {pending.map((fee) => (
        <div
          key={fee.id}
          className="flex flex-wrap items-center justify-between gap-3 border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="text-sm">
            <span className="font-medium text-destructive">
              Cargo pendiente de {money(fee.amount_cents)}
            </span>{" "}
            <span className="text-muted-foreground">
              · {fee.reason}. No puedes hacer nuevas reservas hasta pagarlo.
            </span>
          </p>
          {paymentsConfigured() ? (
            <button
              onClick={() => pay.mutate(fee.id)}
              disabled={pay.isPending}
              className="bg-foreground px-5 py-2.5 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
            >
              {pay.isPending ? "Cobrando…" : "Pagar ahora"}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Págalo en recepción.</span>
          )}
        </div>
      ))}
    </div>
  );
}

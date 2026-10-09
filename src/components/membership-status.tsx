import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PlanCheckoutModal, type CheckoutPlan } from "@/components/payments/plan-checkout-modal";
import { describeMembershipToday, daysUntil } from "@/lib/membership-display";

export type MembershipStatus = {
  plan_id: string;
  plan_name: string;
  daily_limit: number;
  ends_at: string;
  used_today: number;
  renewal_plan_id: string | null;
  renewal_plan_name: string | null;
  renewal_price_cents: number | null;
};

export function useMembershipStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ["membership-status", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("membership_status", { _user_id: userId! });
      if (error) throw error;
      return (data as unknown as MembershipStatus | null) ?? null;
    },
  });
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Monterrey" }).format(
    new Date(iso),
  );

export function MembershipStatusCard({
  userId,
  user,
  staffView = false,
}: {
  userId: string | undefined;
  user?: { id?: string; email?: string } | null;
  staffView?: boolean;
}) {
  const { data: m } = useMembershipStatus(userId);
  const [renewing, setRenewing] = useState<CheckoutPlan | null>(null);
  if (!m) return null;
  const days = daysUntil(m.ends_at);

  return (
    <div className="border border-foreground p-5">
      <p className="eyebrow">Membresía activa</p>
      <p className="mt-1 text-lg">{m.plan_name}</p>
      <p className="mt-1 text-sm">{m.daily_limit === 1 ? "1 clase por día" : `${m.daily_limit} clases por día`}</p>
      <p className="mt-3 text-sm">{describeMembershipToday(m.daily_limit, m.used_today)}</p>
      <p className="mt-1 text-sm text-muted-foreground">Activa hasta el {fmtDate(m.ends_at)}</p>
      {days <= 5 ? (
        <p className="mt-1 text-sm font-medium">
          {days <= 0 ? "Tu membresía vence hoy" : `Tu membresía vence en ${days} ${days === 1 ? "día" : "días"}`}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Las clases no son acumulables. Tu acceso termina en la fecha de vencimiento.
      </p>
      {!staffView && m.renewal_plan_id ? (
        <button
          onClick={() =>
            setRenewing({
              id: m.renewal_plan_id!,
              name: m.renewal_plan_name ?? "Renovación semestral",
              price_cents: m.renewal_price_cents ?? 0,
              tokens: 0,
              recurring: false,
            })
          }
          className="mt-4 w-full bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background"
        >
          Renovar semestral · 180 días
        </button>
      ) : null}
      {renewing ? (
        <PlanCheckoutModal plan={renewing} user={user ?? null} onClose={() => setRenewing(null)} />
      ) : null}
    </div>
  );
}

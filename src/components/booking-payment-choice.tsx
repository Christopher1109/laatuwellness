import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// Si el cliente tiene membresía y créditos de paquete, elige con qué reserva.
// Por defecto usa la membresía si todavía le quedan clases ese día.
export function BookingPaymentChoice({
  startsAt,
  useCredits,
  onChange,
}: {
  startsAt: string;
  useCredits: boolean;
  onChange: (useCredits: boolean) => void;
}) {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["booking-choice", user?.id, startsAt],
    enabled: Boolean(user),
    queryFn: async () => {
      const [usage, bal] = await Promise.all([
        supabase.rpc("membership_day_usage", { _user_id: user!.id, _at: startsAt }),
        supabase.rpc("token_balance", { _user_id: user!.id }),
      ]);
      if (usage.error) throw usage.error;
      if (bal.error) throw bal.error;
      const u = usage.data as { daily_limit: number; used: number } | null;
      return {
        membership: u,
        membershipAvailable: Boolean(u && u.used < u.daily_limit),
        credits: Number(bal.data ?? 0),
      };
    },
  });

  const membershipAvailable = data?.membershipAvailable ?? false;
  useEffect(() => {
    if (!data) return;
    if (!data.membership) return;
    onChange(!membershipAvailable && data.credits > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.membership?.used, data?.credits]);

  if (!data?.membership) return null;

  const options = [
    {
      value: false,
      label: "Con mi membresía",
      hint: membershipAvailable
        ? `Te quedan ${data.membership.daily_limit - data.membership.used} de ${data.membership.daily_limit} ese día`
        : "Ya usaste tu membresía ese día",
      disabled: !membershipAvailable,
    },
    {
      value: true,
      label: "Con crédito de paquete",
      hint: data.credits > 0 ? `${data.credits} disponibles · se usa el que vence primero` : "Sin créditos",
      disabled: data.credits <= 0,
    },
  ];

  return (
    <div className="mt-5">
      <p className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
        Reservar con
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "border p-2 text-left text-xs disabled:opacity-40",
              useCredits === o.value ? "border-foreground" : "border-border",
            )}
          >
            <span className="block">{o.label}</span>
            <span className="mt-0.5 block text-[0.65rem] text-muted-foreground">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

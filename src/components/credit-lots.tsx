import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil } from "@/lib/membership-display";

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Monterrey" }).format(
    new Date(iso),
  );

// Créditos de paquetes vigentes, agrupados por fecha de vencimiento.
export function CreditLotsSummary({ userId }: { userId: string | undefined }) {
  const { data: lots } = useQuery({
    queryKey: ["credit-lots", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_lots")
        .select("id, label, remaining, expires_at")
        .eq("user_id", userId!)
        .gt("remaining", 0)
        .order("expires_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      const now = Date.now();
      return (data ?? []).filter((l) => !l.expires_at || new Date(l.expires_at).getTime() > now);
    },
  });

  if (!lots || lots.length === 0) return null;
  const total = lots.reduce((s, l) => s + l.remaining, 0);

  return (
    <div className="border border-border p-5">
      <p className="eyebrow">Créditos de paquetes</p>
      <p className="mt-1 text-2xl">{total}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {lots.map((l) => {
          const days = l.expires_at ? daysUntil(l.expires_at) : null;
          return (
            <li key={l.id} className="border-t border-border pt-2">
              <span>
                {l.remaining} {l.remaining === 1 ? "crédito" : "créditos"} · {l.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {l.expires_at ? `Vence el ${fmt(l.expires_at)}` : "Sin vencimiento"}
              </span>
              {days !== null && days <= 5 ? (
                <span className="block text-xs font-medium">
                  {days <= 0
                    ? "Tus créditos vencen hoy"
                    : `Tus créditos vencen en ${days} ${days === 1 ? "día" : "días"}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Se usan primero los créditos que vencen antes. Los créditos vencidos no se acumulan.
      </p>
    </div>
  );
}

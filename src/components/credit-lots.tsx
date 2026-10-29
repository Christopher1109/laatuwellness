import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil } from "@/lib/membership-display";
import {
  CREDIT_KIND_LABELS,
  CREDIT_KIND_SHORT,
  creditKindOf,
  type CreditKind,
} from "@/lib/credit-kinds";

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
      if (!userId) return [];
      const { data, error } = await supabase
        .from("credit_lots")
        .select("id, label, remaining, starts_at, expires_at, credit_kind")
        .eq("user_id", userId)
        .gt("remaining", 0)
        .order("expires_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      const now = Date.now();
      return (data ?? []).filter((l) => !l.expires_at || new Date(l.expires_at).getTime() > now);
    },
  });

  if (!lots || lots.length === 0) return null;
  const total = lots.reduce((s, l) => s + l.remaining, 0);
  // Totales por tipo: los de DorisFisio solo sirven para su tipo de sesión.
  const byKind = new Map<CreditKind, number>();
  for (const l of lots) {
    const k = creditKindOf(l.credit_kind);
    byKind.set(k, (byKind.get(k) ?? 0) + l.remaining);
  }
  const mixed = byKind.size > 1 || !byKind.has("general");

  return (
    <div className="border border-border p-5">
      <p className="eyebrow">Créditos de paquetes</p>
      <p className="mt-1 text-2xl">{total}</p>
      {mixed ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Array.from(byKind.entries()).map(([k, n]) => (
            <span
              key={k}
              className={`px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.1em] ${
                k === "general" ? "bg-muted" : "bg-emerald-500/10 text-emerald-800"
              }`}
            >
              {n} · {CREDIT_KIND_LABELS[k]}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="mt-3 space-y-2 text-sm">
        {lots.map((l) => {
          const days = l.expires_at ? daysUntil(l.expires_at) : null;
          return (
            <li key={l.id} className="border-t border-border pt-2">
              <span>
                {l.remaining} {l.remaining === 1 ? "crédito" : "créditos"} · {l.label}
              </span>
              {creditKindOf(l.credit_kind) !== "general" ? (
                <span className="ml-2 bg-emerald-500/10 px-1.5 py-0.5 text-[0.58rem] uppercase tracking-[0.1em] text-emerald-800">
                  Solo {CREDIT_KIND_SHORT[creditKindOf(l.credit_kind)]}
                </span>
              ) : null}
              <span className="block text-xs text-muted-foreground">
                {l.expires_at ? `Vence el ${fmt(l.expires_at)}` : "Sin vencimiento"}
              </span>
              {l.starts_at && new Date(l.starts_at).getTime() > Date.now() ? (
                <span className="block text-xs text-muted-foreground">
                  Tu vigencia comienza el {fmt(l.starts_at)}
                </span>
              ) : null}
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
        {mixed
          ? " Los créditos de DorisFisio solo sirven para su tipo de sesión (Upper o Lower, o Full Body) y no para clases del estudio."
          : ""}
      </p>
    </div>
  );
}

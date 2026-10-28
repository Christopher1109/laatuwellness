import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { usePlanLocks } from "@/hooks/use-plan-locks";
import { isPlanInSaleWindow, spotsLeft } from "@/lib/plan-availability";
import { cn } from "@/lib/utils";

// ============================================================================
// Catálogo de paquetes y membresías. Lo usan la página /paquetes y la pestaña
// de compra de la app, así que ambos muestran exactamente los mismos paquetes
// (activos, dentro de su periodo de venta y no exclusivos del staff).
// ============================================================================

export type CatalogPlan = Tables<"token_plans">;

export const PLAN_CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Class Packages",
  membresia: "Membresías",
  consulta: "Align — DorisFisio",
  recuperacion: "Contrast",
};

const SHORT_LABELS: Record<string, string> = {
  clases_pilates: "Clases",
  membresia: "Membresías",
  consulta: "DorisFisio",
  recuperacion: "Contrast",
};

export const PLAN_CATEGORY_HINTS: Record<string, string> = {
  clases_pilates:
    "Compras créditos sueltos, sin compromiso mensual. Válidos por un tiempo limitado.",
  membresia: "Acceso por periodo con un límite de clases por día.",
  consulta: "Sesión individual de recuperación con Doris, se paga por sesión.",
  recuperacion: "Sesión de sauna infrarrojo y cold plunge, se paga por sesión.",
};

const CATEGORY_ORDER = ["clases_pilates", "membresia", "consulta", "recuperacion"];

export function planMoney(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function untilLabel(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "America/Monterrey",
  }).format(new Date(iso));
}

export function usePublicPlans() {
  return useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_plans")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []).filter(
        (p) => !p.is_staff_only && isPlanInSaleWindow(p) && !p.renews_plan_id,
      );
    },
  });
}

function planSummary(p: CatalogPlan) {
  return p.daily_class_limit
    ? `${p.daily_class_limit === 1 ? "1 clase" : `${p.daily_class_limit} clases`} por día · ${p.validity_days ?? 30} días`
    : `${p.tokens} ${p.tokens === 1 ? "crédito" : "créditos"}`;
}

export function PlanCatalog({
  variant,
  onBuy,
}: {
  variant: "page" | "app";
  onBuy: (plan: CatalogPlan) => void;
}) {
  const { user } = useAuth();
  const { data: plans, isLoading } = usePublicPlans();
  const [category, setCategory] = useState<string | null>(null);
  const [openDetails, setOpenDetails] = useState<string | null>(null);

  // Lugares vendidos de membresías con cupo (ej. Founders Access).
  const limitedIds = (plans ?? []).filter((p) => p.max_sales != null).map((p) => p.id);
  const { data: soldCounts } = useQuery({
    queryKey: ["plan-sales-count", limitedIds.join(",")],
    enabled: limitedIds.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const out: Record<string, number> = {};
      for (const id of limitedIds) {
        const { data, error } = await supabase.rpc("plan_sales_count", { _plan_id: id });
        if (error) throw error;
        out[id] = Number(data ?? 0);
      }
      return out;
    },
  });

  const planLock = usePlanLocks(user?.id);

  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogPlan[]>();
    for (const p of plans ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    const known = CATEGORY_ORDER.filter((c) => groups.has(c));
    const extra = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c));
    return [...known, ...extra].map((c) => [c, groups.get(c)!] as const);
  }, [plans]);

  if (isLoading) return <p className="text-muted-foreground">Cargando paquetes…</p>;
  if (grouped.length === 0) {
    return (
      <p className="text-muted-foreground">
        Aún no hay paquetes publicados. Escríbenos por WhatsApp y te ayudamos directo.
      </p>
    );
  }

  const visible = category ? grouped.filter(([c]) => c === category) : grouped;
  const isApp = variant === "app";

  return (
    <div>
      {isApp ? (
        <div className="-mx-5 mb-6 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[null, ...grouped.map(([c]) => c)].map((c) => (
            <button
              key={c ?? "todos"}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-[0.64rem] uppercase tracking-[0.14em]",
                category === c
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground",
              )}
            >
              {c ? (SHORT_LABELS[c] ?? c) : "Todos"}
            </button>
          ))}
        </div>
      ) : null}

      <div className={isApp ? "space-y-10" : "space-y-20"}>
        {visible.map(([cat, items]) => (
          <div key={cat}>
            <div className={isApp ? "pb-2" : "border-b border-foreground pb-4"}>
              <p className="eyebrow">{PLAN_CATEGORY_LABELS[cat] ?? cat}</p>
              {PLAN_CATEGORY_HINTS[cat] ? (
                <p className={cn("mt-2 text-muted-foreground", isApp ? "text-xs" : "text-sm")}>
                  {PLAN_CATEGORY_HINTS[cat]}
                </p>
              ) : null}
            </div>
            <div
              className={cn(
                "grid",
                isApp ? "mt-3 gap-3" : "mt-8 gap-6 sm:grid-cols-2 lg:grid-cols-3",
              )}
            >
              {items.map((p) => {
                const left = spotsLeft(p.max_sales, soldCounts?.[p.id] ?? 0);
                const soldOut = left === 0;
                const lockLabel = soldOut ? "Agotado" : planLock(p);
                const blocked = Boolean(lockLabel);
                const until = p.is_promo ? untilLabel(p.available_until) : null;
                const showDetails = !isApp || openDetails === p.id;
                const hasDetails = Boolean(p.includes || p.excludes || p.terms || p.description);
                return (
                  <article
                    key={p.id}
                    className={cn(
                      "flex flex-col bg-background",
                      isApp ? "rounded-lg p-5" : "p-8",
                      p.is_promo
                        ? cn(
                            "border-2 border-foreground shadow-lg",
                            !isApp && "sm:col-span-2 lg:col-span-1",
                          )
                        : "border border-border shadow-sm",
                    )}
                  >
                    {p.is_promo ? (
                      <p className="mb-3 self-start bg-foreground px-2 py-1 text-[0.6rem] uppercase tracking-[0.18em] text-background">
                        Promoción
                      </p>
                    ) : null}
                    <div className={cn(isApp && "flex items-start justify-between gap-3")}>
                      <div className="min-w-0">
                        <h3 className={isApp ? "text-lg" : "text-xl"}>{p.name}</h3>
                        {p.subtitle ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {p.subtitle}
                          </p>
                        ) : null}
                      </div>
                      {isApp ? (
                        <p className="shrink-0 text-right text-xl">
                          {p.compare_at_price_cents ? (
                            <span className="block text-xs text-muted-foreground line-through">
                              {planMoney(p.compare_at_price_cents, p.currency)}
                            </span>
                          ) : null}
                          {planMoney(p.price_cents, p.currency)}
                        </p>
                      ) : null}
                    </div>
                    {!isApp && p.description ? (
                      <p className="mt-3 text-sm text-muted-foreground">{p.description}</p>
                    ) : null}

                    {!isApp ? (
                      <p className="mt-6 text-2xl">
                        {p.compare_at_price_cents ? (
                          <span className="mr-2 text-base text-muted-foreground line-through">
                            {planMoney(p.compare_at_price_cents, p.currency)}
                          </span>
                        ) : null}
                        {planMoney(p.price_cents, p.currency)}
                      </p>
                    ) : null}
                    {p.is_promo && (p.max_sales || until) ? (
                      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-foreground">
                        {p.max_sales ? `Solo ${p.max_sales} lugares` : ""}
                        {p.max_sales && until ? " · " : ""}
                        {until ? `hasta el ${until}` : ""}
                      </p>
                    ) : null}
                    {p.max_sales && left !== null && soldCounts ? (
                      <SpotsBar total={p.max_sales} left={left} />
                    ) : null}
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {planSummary(p)}
                      {p.recurring ? " · recurrente" : ""}
                    </p>

                    <button
                      type="button"
                      onClick={() => onBuy(p)}
                      disabled={blocked}
                      className={cn(
                        "w-full border px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground",
                        isApp
                          ? "mt-4 border-foreground bg-foreground text-background disabled:bg-transparent"
                          : "mt-6 border-foreground hover:bg-foreground hover:text-background disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                      )}
                    >
                      {blocked ? lockLabel : user ? "Comprar" : "Inicia sesión para comprar"}
                    </button>

                    {isApp && hasDetails ? (
                      <button
                        type="button"
                        onClick={() => setOpenDetails(openDetails === p.id ? null : p.id)}
                        className="mt-3 inline-flex items-center gap-1 self-center text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        {openDetails === p.id ? "Ocultar detalles" : "Ver qué incluye"}
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            openDetails === p.id && "rotate-180",
                          )}
                        />
                      </button>
                    ) : null}

                    {showDetails && hasDetails ? (
                      <div
                        className={cn(
                          "flex-1 space-y-4 border-t border-border",
                          isApp ? "mt-3 pt-4" : "mt-6 pt-5",
                        )}
                      >
                        {isApp && p.description ? (
                          <p className="text-xs text-muted-foreground">{p.description}</p>
                        ) : null}
                        {p.includes ? (
                          <div>
                            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-foreground">
                              Incluye
                            </p>
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {p.includes
                                .split("\n")
                                .filter(Boolean)
                                .map((line, i) => (
                                  <li key={i}>· {line}</li>
                                ))}
                            </ul>
                          </div>
                        ) : null}
                        {p.excludes ? (
                          <div>
                            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                              No incluye
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">{p.excludes}</p>
                          </div>
                        ) : null}
                        {p.terms ? (
                          <div>
                            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                              Restricciones
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              {p.terms}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Barra de cupo de una membresía limitada: se va llenando conforme se venden
// lugares y dice cuántos quedan.
export function SpotsBar({ total, left }: { total: number; left: number }) {
  const sold = Math.min(total, Math.max(0, total - left));
  const pct = total > 0 ? Math.round((sold / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={sold}
        aria-label={`${sold} de ${total} lugares vendidos`}
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 flex justify-between text-[0.68rem] uppercase tracking-[0.14em]">
        <span className="text-muted-foreground">
          {sold} de {total} vendidos
        </span>
        <span className="font-medium text-foreground">
          {left === 0 ? "Agotado" : left === 1 ? "Queda 1 lugar" : `Quedan ${left} lugares`}
        </span>
      </p>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/describe-error";
import { CREDIT_KIND_SHORT, creditKindOf, type CreditKind } from "@/lib/credit-kinds";
import { summarizeSessions, type RecoverySession } from "@/lib/recovery-sessions";
import { cn } from "@/lib/utils";
import { Popout, input } from "@/components/admin/ops-panels";

const TZ = "America/Monterrey";
const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const mondayOf = (d: Date) =>
  addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));

type View = "dia" | "semana" | "mes";

/** Rango [from, to] (fechas locales) de la vista alrededor de `anchor`. */
function rangeFor(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === "dia") {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    return { from: d, to: d };
  }
  if (view === "semana") {
    const m = mondayOf(anchor);
    return { from: m, to: addDays(m, 6) };
  }
  return {
    from: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
    to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
  };
}

function shift(view: View, anchor: Date, dir: -1 | 1): Date {
  if (view === "dia") return addDays(anchor, dir);
  if (view === "semana") return addDays(anchor, dir * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

function periodLabel(view: View, from: Date, to: Date) {
  if (view === "mes") {
    return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(from);
  }
  if (view === "dia") {
    return new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(from);
  }
  const f = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
  return `${f.format(from)} – ${f.format(to)}`;
}

const dayTitle = (day: string) =>
  new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day}T12:00:00`),
  );
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(
    new Date(iso),
  );
const localDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

/** Etiqueta de tipo con los colores de la marca. */
function KindTag({ kind, className }: { kind: CreditKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.14em]",
        kind === "doris_fb"
          ? "bg-foreground text-background"
          : kind === "doris_ul"
            ? "bg-secondary text-secondary-foreground"
            : "border border-border text-muted-foreground",
        className,
      )}
    >
      {kind === "general" ? "Sin tipo" : CREDIT_KIND_SHORT[kind]}
    </span>
  );
}

// ============================================================================
// MIS CONSULTAS
// ============================================================================
export function RecoverySessionsPanel() {
  const [view, setView] = useState<View>("mes");
  const [anchor, setAnchor] = useState(() => new Date());
  const { from, to } = rangeFor(view, anchor);
  const fromKey = ymd(from);
  const toKey = ymd(to);

  const { data, isLoading, error } = useQuery({
    queryKey: ["recovery-sessions", fromKey, toKey],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("recovery_sessions", {
        _from: fromKey,
        _to: toKey,
      });
      if (error) throw error;
      return (data ?? []) as RecoverySession[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);
  const summary = useMemo(() => summarizeSessions(rows), [rows]);
  const now = Date.now();
  const done = rows.filter((s) => new Date(s.starts_at).getTime() <= now).length;
  const ul = summary.byKind.doris_ul;
  const fb = summary.byKind.doris_fb;
  const ulPrice = ul.count ? ul.cents / ul.count : null;
  const fbPrice = fb.count ? fb.cents / fb.count : null;
  const ulShare = summary.totalCents ? (ul.cents / summary.totalCents) * 100 : 0;

  // Barras por día (semana y mes).
  const days = useMemo(() => {
    if (view === "dia") return [];
    const counts = new Map(summary.byDay.map((d) => [d.day, d.sessions.length]));
    const list: { key: string; date: Date; count: number }[] = [];
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      list.push({ key: ymd(d), date: new Date(d), count: counts.get(ymd(d)) ?? 0 });
    }
    return list;
  }, [view, summary.byDay, fromKey, toKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const todayKey = ymd(new Date());

  const downloadCsv = () => {
    const lines = [
      ["Fecha", "Hora", "Cliente", "Correo", "Tipo", "Valor", "Asistió"],
      ...rows.map((s) => [
        dayTitle(localDay(s.starts_at)),
        timeLabel(s.starts_at),
        s.client_name,
        s.client_email,
        CREDIT_KIND_SHORT[creditKindOf(s.credit_kind)],
        String(s.price_cents / 100),
        s.checked_in ? "Sí" : "No",
      ]),
    ];
    const csv = lines
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DorisFisio-consultas-${fromKey}-a-${toKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-8">
      {/* Encabezado + periodo */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">DorisFisio</p>
          <h2 className="statement mt-1 text-3xl">Mis consultas</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-input">
            {(
              [
                ["dia", "Día"],
                ["semana", "Semana"],
                ["mes", "Mes"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "px-4 py-2 text-[0.65rem] uppercase tracking-[0.14em] transition-colors",
                  view === v ? "bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={rows.length === 0}
            className="flex items-center gap-2 border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.14em] hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Descargar
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between border-y border-border py-3">
        <button
          type="button"
          onClick={() => setAnchor((a) => shift(view, a, -1))}
          className="p-2 hover:bg-muted"
          aria-label="Periodo anterior"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-lg capitalize">{periodLabel(view, from, to)}</p>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
          >
            Ir a hoy
          </button>
        </div>
        <button
          type="button"
          onClick={() => setAnchor((a) => shift(view, a, 1))}
          className="p-2 hover:bg-muted"
          aria-label="Periodo siguiente"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Resumen */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col justify-between bg-foreground p-6 text-background">
          <div>
            <p className="text-[0.62rem] uppercase tracking-[0.18em] opacity-70">
              Valor de tus consultas
            </p>
            <p className="statement mt-2 text-5xl">{money(summary.totalCents)}</p>
            <p className="mt-2 text-sm opacity-80">
              {summary.total} consulta{summary.total === 1 ? "" : "s"} · {done} realizada
              {done === 1 ? "" : "s"} · {summary.total - done} próxima
              {summary.total - done === 1 ? "" : "s"}
            </p>
          </div>
          {summary.totalCents > 0 ? (
            <div className="mt-6">
              <div className="flex h-2 w-full overflow-hidden bg-background/15">
                <div className="bg-secondary" style={{ width: `${ulShare}%` }} />
                <div className="bg-background" style={{ width: `${100 - ulShare}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[0.62rem] uppercase tracking-[0.14em] opacity-80">
                <span>Upper o Lower {Math.round(ulShare)}%</span>
                <span>Full Body {Math.round(100 - ulShare)}%</span>
              </div>
            </div>
          ) : null}
        </div>

        {(
          [
            ["doris_ul", "Upper o Lower", ul, ulPrice],
            ["doris_fb", "Full Body", fb, fbPrice],
          ] as const
        ).map(([kind, label, stats, price]) => (
          <div key={kind} className="border border-border p-6">
            <div className="flex items-center justify-between">
              <p className="eyebrow">{label}</p>
              <KindTag kind={kind} />
            </div>
            <p className="statement mt-3 text-5xl">{stats.count}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.count === 1 ? "consulta" : "consultas"}
            </p>
            <p className="mt-4 border-t border-border pt-3 text-sm">
              {price !== null ? (
                <>
                  {stats.count} × {money(price)} ={" "}
                  <span className="font-medium">{money(stats.cents)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Sin consultas en este periodo</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Actividad por día */}
      {days.length > 0 ? (
        <div className="border border-border p-5">
          <p className="eyebrow">Consultas por día</p>
          <div className="mt-4 flex h-28 items-end gap-1">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                title={`${dayTitle(d.key)}: ${d.count}`}
                onClick={() => {
                  setView("dia");
                  setAnchor(d.date);
                }}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                {d.count > 0 ? (
                  <span className="text-[0.6rem] text-muted-foreground">{d.count}</span>
                ) : null}
                <span
                  className={cn(
                    "w-full transition-colors group-hover:bg-secondary",
                    d.count > 0 ? "bg-foreground" : "bg-muted",
                  )}
                  style={{ height: `${d.count > 0 ? Math.max(8, (d.count / maxDay) * 80) : 3}%` }}
                />
                <span
                  className={cn(
                    "text-[0.58rem]",
                    d.key === todayKey ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {view === "semana"
                    ? new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(d.date)
                    : d.date.getDate()}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Detalle */}
      {error ? (
        <p className="text-sm text-destructive">{describeError(error)}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : summary.byDay.length === 0 ? (
        <div className="border border-dashed border-border px-6 py-12 text-center">
          <p className="statement text-xl">Sin consultas en este periodo</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Las sesiones que apartes en tu agenda aparecen aquí con su tipo y su valor.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {summary.byDay.map((d) => (
            <section key={d.day}>
              <div className="flex items-baseline justify-between border-b border-foreground pb-2">
                <h3 className="text-lg capitalize">{dayTitle(d.day)}</h3>
                <p className="text-sm text-muted-foreground">
                  {d.sessions.length} · {money(d.cents)}
                </p>
              </div>
              <ul className="divide-y divide-border">
                {d.sessions.map((s) => {
                  const kind = creditKindOf(s.credit_kind);
                  const upcoming = new Date(s.starts_at).getTime() > now;
                  return (
                    <li
                      key={s.booking_id}
                      className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-4 py-3"
                    >
                      <span className="statement text-lg">{timeLabel(s.starts_at)}</span>
                      <span className="min-w-0">
                        <span className="block truncate">{s.client_name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <KindTag kind={kind} />
                          <span
                            className={cn(
                              "text-[0.62rem] uppercase tracking-[0.12em]",
                              s.checked_in
                                ? "text-foreground"
                                : upcoming
                                  ? "text-muted-foreground"
                                  : "text-destructive",
                            )}
                          >
                            {s.checked_in ? "✓ Asistió" : upcoming ? "Próxima" : "Sin check-in"}
                          </span>
                        </span>
                      </span>
                      <span className="text-right">{money(s.price_cents)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CLIENTES (vista de DorisFisio): sin ingresos; solo sus créditos y agregar.
// ============================================================================
type RecoveryClient = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  doris_ul: number;
  doris_fb: number;
  last_session: string | null;
  next_session: string | null;
};

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(iso));

export function RecoveryClientsPanel() {
  const [search, setSearch] = useState("");
  const [onlyWithCredits, setOnlyWithCredits] = useState(false);
  const [adding, setAdding] = useState<RecoveryClient | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["recovery-clients"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("recovery_clients");
      if (error) throw error;
      return (data ?? []) as RecoveryClient[];
    },
  });

  const all = data ?? [];
  const withCredits = all.filter((c) => c.doris_ul + c.doris_fb > 0);
  const q = search.trim().toLowerCase();
  const list = (onlyWithCredits ? withCredits : all).filter(
    (c) =>
      !q ||
      c.full_name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q),
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">DorisFisio</p>
        <h2 className="statement mt-1 text-3xl">Clientes</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Todas las personas con cuenta en Läätu. Aquí solo ves y agregas créditos de DorisFisio
          (Upper o Lower y Full Body).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono…"
            className={`${input} pl-9`}
          />
        </div>
        <div className="flex border border-input">
          {(
            [
              [false, `Todos · ${all.length}`],
              [true, `Con créditos · ${withCredits.length}`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setOnlyWithCredits(v)}
              className={cn(
                "px-4 py-2 text-[0.65rem] uppercase tracking-[0.14em]",
                onlyWithCredits === v ? "bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{describeError(error)}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin resultados.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {list.map((c) => {
            const name = c.full_name || c.email;
            return (
              <li
                key={c.id}
                className="grid items-center gap-3 py-4 sm:grid-cols-[2.5rem_1fr_auto_auto]"
              >
                <span className="hidden h-10 w-10 items-center justify-center bg-muted text-sm uppercase sm:flex">
                  {name.slice(0, 1)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.email}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </span>
                  {c.next_session || c.last_session ? (
                    <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">
                      {c.next_session
                        ? `Próxima sesión: ${shortDate(c.next_session)}`
                        : `Última sesión: ${shortDate(c.last_session!)}`}
                    </span>
                  ) : null}
                </span>
                <span className="flex gap-2">
                  {(
                    [
                      ["doris_ul", c.doris_ul],
                      ["doris_fb", c.doris_fb],
                    ] as const
                  ).map(([kind, n]) => (
                    <span
                      key={kind}
                      className={cn(
                        "flex min-w-[6.5rem] items-center justify-between gap-2 border px-3 py-1.5",
                        n > 0 ? "border-foreground" : "border-border text-muted-foreground",
                      )}
                    >
                      <span className="text-[0.58rem] uppercase tracking-[0.12em]">
                        {CREDIT_KIND_SHORT[kind]}
                      </span>
                      <span className="text-base">{n}</span>
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  onClick={() => setAdding(c)}
                  className="flex items-center justify-center gap-1.5 border border-input px-3 py-2 text-[0.62rem] uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
                >
                  <Plus className="h-3.5 w-3.5" /> Créditos
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? <AddDorisCredits client={adding} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}

function AddDorisCredits({ client, onClose }: { client: RecoveryClient; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"doris_ul" | "doris_fb" | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");

  const { data: prices } = useQuery({
    queryKey: ["recovery-plan-prices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("token_plans")
        .select("credit_kind, price_cents, tokens")
        .in("credit_kind", ["doris_ul", "doris_fb"]);
      const map = new Map<string, number>();
      for (const p of data ?? []) {
        if (!map.has(p.credit_kind) && p.tokens > 0) {
          map.set(p.credit_kind, p.price_cents / p.tokens);
        }
      }
      return map;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!kind) throw new Error("Elige el tipo de crédito.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
      const { error } = await (supabase.rpc as any)("recovery_add_credits", {
        _user_id: client.id,
        _credit_kind: kind,
        _qty: qty,
        _reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        `Listo: ${qty} crédito${qty === 1 ? "" : "s"} de ${CREDIT_KIND_SHORT[kind!]} para ${
          client.full_name || client.email
        }.`,
      );
      void qc.invalidateQueries({ queryKey: ["recovery-clients"] });
      void qc.invalidateQueries({ queryKey: ["credit-lots", client.id] });
      onClose();
    },
    onError: (e) => toast.error(describeError(e, "No se pudieron agregar los créditos.")),
  });

  return (
    <Popout onClose={onClose}>
      <p className="eyebrow">Agregar créditos de DorisFisio</p>
      <h3 className="statement mt-1 text-2xl">{client.full_name || client.email}</h3>
      <p className="text-xs text-muted-foreground">{client.email}</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {(["doris_ul", "doris_fb"] as const).map((k) => {
          const current = k === "doris_ul" ? client.doris_ul : client.doris_fb;
          const price = prices?.get(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "border p-4 text-left transition-colors",
                kind === k ? "border-foreground bg-foreground text-background" : "border-input",
              )}
            >
              <span className="block text-sm">{CREDIT_KIND_SHORT[k]}</span>
              <span className="mt-1 block text-[0.65rem] opacity-70">
                {price ? `${money(price)} por sesión · ` : ""}tiene {current}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between border border-border px-4 py-3">
        <span className="text-sm">Cantidad</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="border border-input px-3 py-1"
            aria-label="Uno menos"
          >
            −
          </button>
          <span className="w-6 text-center text-lg">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(20, q + 1))}
            className="border border-input px-3 py-1"
            aria-label="Uno más"
          >
            +
          </button>
        </span>
      </div>

      <label className="mt-4 block text-xs">
        <span className="eyebrow">Motivo (opcional)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={120}
          placeholder="Ej. pagó directo conmigo en efectivo"
          className={input}
        />
      </label>

      <p className="mt-4 text-xs text-muted-foreground">
        Solo se pueden agregar créditos. Si te equivocas, pide a administración que los quite.
      </p>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em]"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!kind || add.isPending}
          onClick={() => add.mutate()}
          className="flex-1 bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
        >
          {add.isPending
            ? "Agregando…"
            : kind
              ? `Agregar ${qty} de ${CREDIT_KIND_SHORT[kind]}`
              : "Elige el tipo"}
        </button>
      </div>
    </Popout>
  );
}

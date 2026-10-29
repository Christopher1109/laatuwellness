import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/describe-error";
import { CREDIT_KIND_SHORT, creditKindOf } from "@/lib/credit-kinds";
import { summarizeSessions, type RecoverySession } from "@/lib/recovery-sessions";
import { input } from "@/components/admin/ops-panels";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Preset = "hoy" | "semana" | "mes" | "mes-anterior" | "otro";

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  if (p === "hoy") return { from: ymd(now), to: ymd(now) };
  if (p === "semana") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: ymd(monday), to: ymd(sunday) };
  }
  if (p === "mes-anterior") {
    return {
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return {
    from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mes" },
  { key: "mes-anterior", label: "Mes anterior" },
  { key: "otro", label: "Otras fechas" },
];

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day}T12:00:00`),
  );
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", {
    timeStyle: "short",
    timeZone: "America/Monterrey",
  }).format(new Date(iso));

/**
 * Mis consultas (DorisFisio): cuántas sesiones lleva, de qué día, de qué
 * tipo (Upper o Lower / Full Body) y cuánto vale cada una según el precio
 * de su paquete.
 */
export function RecoverySessionsPanel() {
  const [preset, setPreset] = useState<Preset>("mes");
  const [custom, setCustom] = useState(() => presetRange("mes"));
  const range = preset === "otro" ? custom : presetRange(preset);

  const { data, isLoading, error } = useQuery({
    queryKey: ["recovery-sessions", range.from, range.to],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("recovery_sessions", {
        _from: range.from,
        _to: range.to,
      });
      if (error) throw error;
      return (data ?? []) as RecoverySession[];
    },
  });

  const summary = useMemo(() => summarizeSessions(data ?? []), [data]);
  const now = Date.now();
  const done = (data ?? []).filter((s) => new Date(s.starts_at).getTime() <= now).length;

  const downloadCsv = () => {
    const rows = [
      ["Fecha", "Hora", "Cliente", "Correo", "Tipo", "Precio", "Asistió"],
      ...(data ?? []).map((s) => [
        dayLabel(
          new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey" }).format(
            new Date(s.starts_at),
          ),
        ),
        timeLabel(s.starts_at),
        s.client_name,
        s.client_email,
        CREDIT_KIND_SHORT[creditKindOf(s.credit_kind)],
        String(s.price_cents / 100),
        s.checked_in ? "Sí" : "No",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DorisFisio-consultas-${range.from}-a-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="statement text-2xl">Mis consultas</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Sesiones apartadas en el consultorio de DorisFisio. El valor de cada una es el precio de
          su paquete (Upper o Lower, o Full Body).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`border px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] ${
              preset === p.key ? "border-foreground bg-foreground text-background" : "border-input"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "otro" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="eyebrow">Desde</span>
              <input
                type="date"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className={`${input} h-10`}
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Hasta</span>
              <input
                type="date"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className={`${input} h-10`}
              />
            </label>
          </div>
        ) : null}
        <button
          type="button"
          onClick={downloadCsv}
          disabled={(data ?? []).length === 0}
          className="ml-auto border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] disabled:opacity-40"
        >
          Descargar lista
        </button>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-background p-5">
          <p className="eyebrow">Consultas</p>
          <p className="mt-1 text-3xl">{summary.total}</p>
          <p className="text-xs text-muted-foreground">
            {done} ya pasaron · {summary.total - done} próximas
          </p>
        </div>
        <div className="bg-background p-5">
          <p className="eyebrow">Upper o Lower</p>
          <p className="mt-1 text-3xl">{summary.byKind.doris_ul.count}</p>
          <p className="text-xs text-muted-foreground">{money(summary.byKind.doris_ul.cents)}</p>
        </div>
        <div className="bg-background p-5">
          <p className="eyebrow">Full Body</p>
          <p className="mt-1 text-3xl">{summary.byKind.doris_fb.count}</p>
          <p className="text-xs text-muted-foreground">{money(summary.byKind.doris_fb.cents)}</p>
        </div>
        <div className="bg-background p-5">
          <p className="eyebrow">Total del periodo</p>
          <p className="mt-1 text-3xl">{money(summary.totalCents)}</p>
          {summary.byKind.general.count > 0 ? (
            <p className="text-xs text-muted-foreground">
              {summary.byKind.general.count} sin tipo (de antes del cambio)
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{describeError(error)}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : summary.byDay.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin consultas en estas fechas.</p>
      ) : (
        <div className="space-y-3">
          {summary.byDay.map((d) => (
            <details key={d.day} className="border border-border" open>
              <summary className="flex cursor-pointer items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm">
                <span className="capitalize">{dayLabel(d.day)}</span>
                <span className="text-muted-foreground">
                  {d.sessions.length} consulta{d.sessions.length === 1 ? "" : "s"} ·{" "}
                  {money(d.cents)}
                </span>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="px-4 py-2">Hora</th>
                      <th className="px-4 py-2">Cliente</th>
                      <th className="px-4 py-2">Tipo</th>
                      <th className="px-4 py-2">Asistió</th>
                      <th className="px-4 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.sessions.map((s) => {
                      const kind = creditKindOf(s.credit_kind);
                      return (
                        <tr key={s.booking_id}>
                          <td className="whitespace-nowrap px-4 py-2">{timeLabel(s.starts_at)}</td>
                          <td className="px-4 py-2">
                            {s.client_name}
                            <span className="block text-xs text-muted-foreground">
                              {s.client_email}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] ${
                                kind === "doris_fb"
                                  ? "bg-violet-500/10 text-violet-800"
                                  : kind === "doris_ul"
                                    ? "bg-emerald-500/10 text-emerald-800"
                                    : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {kind === "general" ? "Sin tipo" : CREDIT_KIND_SHORT[kind]}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {s.checked_in
                              ? "Sí"
                              : new Date(s.starts_at).getTime() > now
                                ? "Próxima"
                                : "Sin check-in"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right">
                            {money(s.price_cents)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

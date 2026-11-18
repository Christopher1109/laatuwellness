import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/describe-error";
import { DEFAULT_POLICY, type CancellationPolicy } from "@/lib/cancellation-policy";
import type { MissStatus } from "@/components/miss-status-banner";
import type { RenewalStatus } from "@/components/renewal-reminder";

// ============================================================================
// POLÍTICAS — configuración de cancelación/faltas, reporte por periodo y
// membresías que vencen pronto sin tarjeta. Solo admin (menú Negocio).
// ============================================================================

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Monterrey" }).format(
    new Date(iso),
  );

const input =
  "w-full border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground";

type PenaltyPlan = { id: string; name: string; no_show_penalty: boolean };

export function PolicyPanel() {
  const qc = useQueryClient();

  const policy = useQuery({
    queryKey: ["admin-cancellation-policy"],
    queryFn: async (): Promise<CancellationPolicy> => {
      const { data, error } = await supabase
        .from("cancellation_policy")
        .select("cancel_hours, free_misses, fine_cents")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as CancellationPolicy | null) ?? DEFAULT_POLICY;
    },
  });

  const plans = useQuery({
    queryKey: ["admin-penalty-plans"],
    queryFn: async (): Promise<PenaltyPlan[]> => {
      const { data, error } = await supabase
        .from("token_plans")
        .select("id, name, no_show_penalty")
        .eq("category", "membresia")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as PenaltyPlan[];
    },
  });

  const [form, setForm] = useState<CancellationPolicy | null>(null);
  const current = form ?? policy.data ?? DEFAULT_POLICY;

  const savePolicy = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("cancellation_policy")
        .update({
          cancel_hours: current.cancel_hours,
          free_misses: current.free_misses,
          fine_cents: current.fine_cents,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Política guardada.");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["admin-cancellation-policy"] });
      void qc.invalidateQueries({ queryKey: ["cancellation-policy"] });
    },
    onError: (e) => toast.error(describeError(e, "No se pudo guardar la política.")),
  });

  const togglePlan = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("token_plans")
        .update({ no_show_penalty: enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-penalty-plans"] }),
    onError: (e) => toast.error(describeError(e, "No se pudo actualizar el plan.")),
  });

  return (
    <div className="space-y-8">
      <section className="border border-border p-5">
        <p className="eyebrow">Cancelaciones y faltas</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Horas para cancelar sin penalización
            </span>
            <input
              type="number"
              min={0}
              className={input}
              value={current.cancel_hours}
              onChange={(e) =>
                setForm({ ...current, cancel_hours: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Faltas sin cobro antes de la multa
            </span>
            <input
              type="number"
              min={0}
              className={input}
              value={current.free_misses}
              onChange={(e) =>
                setForm({ ...current, free_misses: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Monto de la multa (MXN)
            </span>
            <input
              type="number"
              min={0}
              className={input}
              value={current.fine_cents / 100}
              onChange={(e) =>
                setForm({
                  ...current,
                  fine_cents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)),
                })
              }
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Con estos valores: cancelar con {current.cancel_hours} h o más no tiene penalización;
          la falta número {current.free_misses + 1} cobra {money(current.fine_cents)} a la tarjeta
          guardada y reinicia el contador.
        </p>
        <button
          onClick={() => savePolicy.mutate()}
          disabled={savePolicy.isPending || !form}
          className="mt-4 bg-foreground px-5 py-2.5 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-40"
        >
          Guardar política
        </button>
      </section>

      <section className="border border-border p-5">
        <p className="eyebrow">Planes con multa por faltas</p>
        <div className="mt-4 space-y-2">
          {(plans.data ?? []).map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={p.no_show_penalty}
                onChange={(e) => togglePlan.mutate({ id: p.id, enabled: e.target.checked })}
                className="h-4 w-4 accent-foreground"
              />
              {p.name}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Los paquetes de clases nunca cobran multa: en una falta solo pierden el crédito de esa
          clase.
        </p>
      </section>

      <MissesReport />
      <ExpiringWithoutCard />
    </div>
  );
}

function MissesReport() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const report = useQuery({
    queryKey: ["admin-misses-report", from, to],
    queryFn: async () => {
      const fromIso = new Date(`${from}T00:00:00-06:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59-06:00`).toISOString();
      const { data: misses, error: e1 } = await supabase
        .from("no_shows")
        .select("id, user_id, kind, waived, created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false });
      if (e1) throw e1;
      const { data: fees, error: e2 } = await supabase
        .from("membership_fees")
        .select("id, user_id, amount_cents, status, reason, created_at")
        .eq("kind", "multa")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false });
      if (e2) throw e2;
      const userIds = [...new Set((misses ?? []).map((m) => m.user_id))];
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
        : { data: [] as { id: string; full_name: string }[] };
      const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
      return {
        misses: (misses ?? []).map((m) => ({ ...m, name: nameOf.get(m.user_id) ?? "—" })),
        fees: (fees ?? []).map((f) => ({ ...f, name: nameOf.get(f.user_id) ?? "—" })),
      };
    },
  });

  const charged = (report.data?.fees ?? []).filter((f) => f.status === "charged");
  const pending = (report.data?.fees ?? []).filter((f) => f.status === "pending_charge");

  return (
    <section className="border border-border p-5">
      <p className="eyebrow">Reporte de faltas y multas</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Desde
          <input
            type="date"
            className={`${input} mt-1 w-auto`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Hasta
          <input
            type="date"
            className={`${input} mt-1 w-auto`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <div className="text-sm text-muted-foreground">
          {report.data?.misses.length ?? 0} faltas · {charged.length} multas cobradas (
          {money(charged.reduce((s, f) => s + f.amount_cents, 0))}) · {pending.length} pendientes (
          {money(pending.reduce((s, f) => s + f.amount_cents, 0))})
        </div>
      </div>
      <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
        {(report.data?.misses ?? []).length === 0 ? (
          <li className="py-4 text-muted-foreground">Sin faltas en este periodo.</li>
        ) : (
          (report.data?.misses ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2 py-3">
              <span>
                {m.name}{" "}
                <span className="text-muted-foreground">
                  · {m.kind === "no_asistio" ? "No asistió" : "Cancelación tardía"}
                  {m.waived ? " · condonada" : ""}
                </span>
              </span>
              <span className="text-muted-foreground">{fmtDate(m.created_at)}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function ExpiringWithoutCard() {
  const expiring = useQuery({
    queryKey: ["admin-expiring-no-card"],
    queryFn: async () => {
      const now = new Date().toISOString();
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
      const { data: txs, error } = await supabase
        .from("transactions")
        .select("user_id, access_ends_at, token_plans!inner(name, no_show_penalty)")
        .eq("status", "completed")
        .eq("token_plans.no_show_penalty", true)
        .gte("access_ends_at", now)
        .lte("access_ends_at", in7)
        .order("access_ends_at");
      if (error) throw error;
      const userIds = [...new Set((txs ?? []).map((t) => t.user_id))];
      const [{ data: cards }, { data: profiles }] = await Promise.all([
        userIds.length
          ? supabase.from("saved_cards").select("user_id, auto_renew").in("user_id", userIds)
          : Promise.resolve({ data: [] as { user_id: string; auto_renew: boolean }[] }),
        userIds.length
          ? supabase.from("profiles").select("id, full_name, email").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
      ]);
      const cardOf = new Map((cards ?? []).map((c) => [c.user_id, c.auto_renew]));
      const profileOf = new Map((profiles ?? []).map((p) => [p.id, p]));
      // Una fila por clienta: su vencimiento más lejano dentro de la ventana.
      const byUser = new Map<string, { name: string; email: string; plan: string; ends: string }>();
      for (const t of txs ?? []) {
        if (cardOf.get(t.user_id) || !t.access_ends_at) continue;
        const ends = t.access_ends_at;
        const plan = (t.token_plans as unknown as { name: string } | null)?.name ?? "Membresía";
        const existing = byUser.get(t.user_id);
        if (!existing || ends > existing.ends) {
          byUser.set(t.user_id, {
            name: profileOf.get(t.user_id)?.full_name ?? "—",
            email: profileOf.get(t.user_id)?.email ?? "",
            plan,
            ends,
          });
        }
      }
      return [...byUser.values()];
    },
  });

  return (
    <section className="border border-border p-5">
      <p className="eyebrow">Vencen en 7 días sin tarjeta</p>
      <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
        {(expiring.data ?? []).length === 0 ? (
          <li className="py-4 text-muted-foreground">
            Nadie con membresía por vencer sin tarjeta registrada.
          </li>
        ) : (
          (expiring.data ?? []).map((r) => (
            <li key={r.email + r.ends} className="flex flex-wrap justify-between gap-2 py-3">
              <span>
                {r.name} <span className="text-muted-foreground">· {r.plan}</span>
              </span>
              <span className="text-muted-foreground">vence {fmtDate(r.ends)}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

// ============================================================================
// FICHA DE CLIENTE — faltas, multas, tarjeta y renovación (panel admin/staff).
// ============================================================================

type NoShowRow = {
  id: string;
  kind: string;
  waived: boolean;
  created_at: string;
  booking_id: string | null;
  fee_id: string | null;
};

type FeeRow = {
  id: string;
  amount_cents: number;
  reason: string;
  status: string;
  created_at: string;
  charged_at: string | null;
};

export function ClientPolicySection({ clientId }: { clientId: string }) {
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ["miss-status", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("miss_status", { _user_id: clientId });
      if (error) throw error;
      return data as unknown as MissStatus;
    },
  });

  const renewal = useQuery({
    queryKey: ["renewal-status", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("renewal_status", { _user_id: clientId });
      if (error) throw error;
      return (data as unknown as RenewalStatus | null) ?? null;
    },
  });

  const misses = useQuery({
    queryKey: ["client-no-shows", clientId],
    queryFn: async (): Promise<NoShowRow[]> => {
      const { data, error } = await supabase
        .from("no_shows")
        .select("id, kind, waived, created_at, booking_id, fee_id")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as NoShowRow[];
    },
  });

  const fees = useQuery({
    queryKey: ["client-fees", clientId],
    queryFn: async (): Promise<FeeRow[]> => {
      const { data, error } = await supabase
        .from("membership_fees")
        .select("id, amount_cents, reason, status, created_at, charged_at")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as FeeRow[];
    },
  });

  const invalidate = () => {
    for (const key of ["miss-status", "client-no-shows", "client-fees", "renewal-status", "client-freezes"]) {
      void qc.invalidateQueries({ queryKey: [key, clientId] });
    }
  };

  const waiveMiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("waive_no_show", { _no_show_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Falta anulada; el contador se ajustó.");
      invalidate();
    },
    onError: (e) => toast.error(describeError(e, "No se pudo anular la falta.")),
  });

  const waiveFee = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("waive_membership_fee", { _fee_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Multa condonada.");
      invalidate();
    },
    onError: (e) => toast.error(describeError(e, "No se pudo condonar la multa.")),
  });

  const paidAtReception = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva aún no está en los tipos generados
      const { error } = await (supabase.rpc as any)("mark_fee_paid_at_reception", { _fee_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marcado como pagado en recepción.");
      invalidate();
    },
    onError: (e) => toast.error(describeError(e, "No se pudo registrar el pago.")),
  });

  const freezes = useQuery({
    queryKey: ["client-freezes", clientId],
    queryFn: async (): Promise<{ days: number; created_at: string }[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla nueva aún no está en los tipos generados
      const { data, error } = await (supabase.from as any)("membership_freezes")
        .select("days, created_at")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { days: number; created_at: string }[];
    },
  });
  const yearAgo = Date.now() - 365 * 86400000;
  const freezeUsed = (freezes.data ?? [])
    .filter((f) => new Date(f.created_at).getTime() > yearAgo)
    .reduce((sum, f) => sum + f.days, 0);
  const freezeLeft = Math.max(0, 14 - freezeUsed);
  const [freezeDays, setFreezeDays] = useState(7);

  const freeze = useMutation({
    mutationFn: async (days: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva aún no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("freeze_membership", {
        _user_id: clientId,
        _days: days,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newEnd) => {
      toast.success(`Membresía congelada. Nuevo vencimiento: ${fmtDate(newEnd)}.`);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["membership-status", clientId] });
    },
    onError: (e) => {
      const msg = String((e as { message?: string })?.message ?? "");
      toast.error(
        msg.includes("FREEZE_LIMIT")
          ? "Supera las 2 semanas de congelamiento permitidas al año."
          : msg.includes("NO_ACTIVE_MEMBERSHIP")
            ? "La clienta no tiene una membresía activa."
            : describeError(e, "No se pudo congelar la membresía."),
      );
    },
  });

  const count = status.data?.count ?? 0;
  const card = renewal.data?.has_card ? renewal.data : null;

  return (
    <div className="border border-border p-5">
      <p className="eyebrow">Faltas y renovación</p>
      <div className="mt-3 grid grid-cols-2 gap-px border border-border bg-border text-center">
        <div className="bg-background px-3 py-2">
          <p className="text-xl leading-none">{count}</p>
          <p className="mt-1 text-[0.55rem] uppercase tracking-[0.14em] text-muted-foreground">
            Faltas en ciclo
          </p>
        </div>
        <div className="bg-background px-3 py-2">
          <p className="text-xl leading-none">
            {card ? `${card.card_brand} ···· ${card.card_last4}` : "—"}
          </p>
          <p className="mt-1 text-[0.55rem] uppercase tracking-[0.14em] text-muted-foreground">
            {card ? (card.auto_renew ? "Renovación automática" : "Sin renovación auto") : "Sin tarjeta"}
          </p>
        </div>
      </div>
      {renewal.data ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {renewal.data.plan_name} · próximo cobro/vencimiento: {fmtDate(renewal.data.ends_at)}
          {renewal.data.opted_out ? " · decidió no renovar" : ""}
          {renewal.data.renewal_plan_name ? ` · renueva con: ${renewal.data.renewal_plan_name}` : ""}
        </p>
      ) : null}

      {renewal.data && new Date(renewal.data.ends_at).getTime() > Date.now() ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">
            Congelar membresía · disponibles {freezeLeft} de 14 días este año
          </span>
          <input
            type="number"
            min={1}
            max={Math.max(1, freezeLeft)}
            value={freezeDays}
            onChange={(e) => setFreezeDays(Number(e.target.value))}
            className="w-16 border border-input bg-background px-2 py-1 text-sm"
            aria-label="Días a congelar"
          />
          <button
            onClick={() => freeze.mutate(freezeDays)}
            disabled={freeze.isPending || freezeLeft === 0 || freezeDays < 1 || freezeDays > freezeLeft}
            className="border border-input px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-50"
          >
            Congelar
          </button>
        </div>
      ) : null}

      {(misses.data ?? []).length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {(misses.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span className={m.waived ? "text-muted-foreground line-through" : ""}>
                {m.kind === "no_asistio" ? "No asistió" : "Cancelación tardía"} ·{" "}
                {fmtDate(m.created_at)}
              </span>
              {!m.waived ? (
                <button
                  onClick={() => waiveMiss.mutate(m.id)}
                  disabled={waiveMiss.isPending}
                  className="shrink-0 border border-input px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-50"
                >
                  Anular
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Sin faltas registradas.</p>
      )}

      {(fees.data ?? []).length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          {(fees.data ?? []).map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <span>
                {money(f.amount_cents)} ·{" "}
                <span className="text-muted-foreground">
                  {f.reason} ·{" "}
                  {f.status === "charged"
                    ? `cobrada ${f.charged_at ? fmtDate(f.charged_at) : ""}`
                    : f.status === "waived" || f.status === "condonada"
                      ? "condonada"
                      : "pendiente"}
                </span>
              </span>
              {f.status === "pending_charge" ? (
                <span className="flex shrink-0 gap-1">
                  <button
                    onClick={() => paidAtReception.mutate(f.id)}
                    disabled={paidAtReception.isPending}
                    className="border border-input px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-50"
                  >
                    Pagada en recepción
                  </button>
                  <button
                    onClick={() => waiveFee.mutate(f.id)}
                    disabled={waiveFee.isPending}
                    className="border border-input px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-50"
                  >
                    Condonar
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

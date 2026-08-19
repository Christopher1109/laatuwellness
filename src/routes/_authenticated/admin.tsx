import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SiteLayout } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import {
  POSPanel,
  InventoryPanel,
  CheckInPanel,
  StaffDirectoryPanel,
  PayrollPanel,
  ShiftSchedulePanel,
  MyAvailabilityPanel,
  TimeClockPanel,
  CoachProfilePanel,
} from "@/components/admin/ops-panels";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Panel del estudio — Läätu Wellness" },
      { name: "description", content: "Administración de horarios, módulos, paquetes y tokens." },
      { property: "og:title", content: "Panel del estudio — Läätu Wellness" },
      { property: "og:description", content: "Administración interna de Läätu Wellness." },
    ],
  }),
  component: Admin,
});

const ADMIN_ONLY_TABS = [
  "Horarios",
  "Módulos",
  "Paquetes",
  "Usuarios",
  "Leads",
  "Staff",
  "Nómina",
  "Turnos",
] as const;
const STAFF_TABS = ["POS", "Inventario", "Check-in", "Checador", "Mi disponibilidad"] as const;
const COACH_TABS = ["Mi perfil", "Checador", "Mi disponibilidad"] as const;
type Tab =
  (typeof ADMIN_ONLY_TABS)[number] | (typeof STAFF_TABS)[number] | (typeof COACH_TABS)[number];

const input =
  "w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground";

function Admin() {
  const { isAdmin, isStaff, isCoach, loading, staffProfile } = useAuth();

  const tabs: Tab[] = isAdmin
    ? [...STAFF_TABS.filter((t) => t !== "Mi disponibilidad"), ...ADMIN_ONLY_TABS]
    : isCoach
      ? [...COACH_TABS]
      : isStaff
        ? [...STAFF_TABS]
        : [];

  const [tab, setTab] = useState<Tab>(tabs[0] ?? "Horarios");

  if (loading) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-6xl px-5 py-24">Cargando…</div>
      </SiteLayout>
    );
  }

  if (!isAdmin && !isStaff) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <h1 className="statement text-3xl">Acceso restringido</h1>
          <p className="mt-4 text-muted-foreground">
            Esta sección es solo para el equipo del estudio.
          </p>
        </div>
      </SiteLayout>
    );
  }

  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  return (
    <SiteLayout>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <p className="eyebrow">Panel del estudio</p>
          <h1 className="statement mt-4 text-[clamp(2rem,5vw,3rem)]">
            {staffProfile ? `Hola, ${staffProfile.full_name.split(" ")[0]}` : "Administración"}
          </h1>
          <nav className="mt-10 flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] transition-colors ${
                  activeTab === t
                    ? "border-foreground bg-foreground text-background"
                    : "border-input hover:border-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        {activeTab === "Horarios" ? <ClassesPanel /> : null}
        {activeTab === "Módulos" ? <ModulesPanel /> : null}
        {activeTab === "Paquetes" ? <PlansPanel /> : null}
        {activeTab === "Usuarios" ? <UsersPanel /> : null}
        {activeTab === "Leads" ? <LeadsPanel /> : null}
        {activeTab === "POS" ? <POSPanel /> : null}
        {activeTab === "Inventario" ? <InventoryPanel /> : null}
        {activeTab === "Check-in" ? <CheckInPanel /> : null}
        {activeTab === "Staff" ? <StaffDirectoryPanel /> : null}
        {activeTab === "Nómina" ? <PayrollPanel /> : null}
        {activeTab === "Turnos" ? <ShiftSchedulePanel /> : null}
        {activeTab === "Mi disponibilidad" ? <MyAvailabilityPanel /> : null}
        {activeTab === "Checador" ? <TimeClockPanel /> : null}
        {activeTab === "Mi perfil" ? <CoachProfilePanel /> : null}
      </div>
    </SiteLayout>
  );
}

function ClassesPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-classes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .order("starts_at")
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (payload: {
      module_key: string;
      room: string;
      instructor: string;
      starts_at: string;
      capacity: number;
      duration_min: number;
    }) => {
      const { error } = await supabase.from("classes").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clase agregada.");
      void qc.invalidateQueries({ queryKey: ["admin-classes"] });
      void qc.invalidateQueries({ queryKey: ["classes"] });
    },
    onError: () => toast.error("No se pudo crear la clase."),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("classes").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-classes"] });
      void qc.invalidateQueries({ queryKey: ["classes"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("classes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clase eliminada.");
      void qc.invalidateQueries({ queryKey: ["admin-classes"] });
      void qc.invalidateQueries({ queryKey: ["classes"] });
    },
    onError: () => toast.error("No se pudo eliminar (¿tiene reservas?)."),
  });

  return (
    <div>
      <form
        className="grid gap-4 border border-border p-6 sm:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const local = String(f.get("starts_at"));
          if (!local) return;
          create.mutate({
            module_key: String(f.get("module_key") || "reformer"),
            room: String(f.get("room") || "Reformer"),
            instructor: String(f.get("instructor") || ""),
            starts_at: new Date(local).toISOString(),
            capacity: Number(f.get("capacity") || 10),
            duration_min: Number(f.get("duration_min") || 50),
          });
          e.currentTarget.reset();
        }}
      >
        <label className="text-xs">
          <span className="eyebrow">Programa</span>
          <select name="module_key" defaultValue="reformer" className={input}>
            <option value="reformer">Reformer Studio</option>
            <option value="salon-2">Segundo Salón</option>
            <option value="contraste">Contrast Therapy</option>
            <option value="nutricion">Nutrition</option>
            <option value="psicologia">Psychology</option>
            <option value="rehabilitacion">Rehabilitación</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="eyebrow">Salón</span>
          <input name="room" defaultValue="Reformer" className={input} />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Instructora</span>
          <input name="instructor" className={input} />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Fecha y hora</span>
          <input name="starts_at" type="datetime-local" required className={input} />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Cupo</span>
          <input
            name="capacity"
            type="number"
            min={1}
            max={40}
            defaultValue={10}
            className={input}
          />
        </label>
        <div className="flex items-end">
          <button className="w-full bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
            Agregar
          </button>
        </div>
      </form>

      <ul className="mt-8 divide-y divide-border border-y border-border text-sm">
        {(data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <span className="w-56">
              {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(c.starts_at),
              )}
            </span>
            <span>{c.room}</span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              {c.module_key}
            </span>
            <span className="text-muted-foreground">{c.instructor}</span>
            <span className="text-muted-foreground">Cupo {c.capacity}</span>
            <div className="flex gap-3">
              <button
                onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                className="border border-input px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em]"
              >
                {c.active ? "Ocultar" : "Publicar"}
              </button>
              <button
                onClick={() => remove.mutate(c.id)}
                className="border border-input px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] text-destructive"
              >
                Borrar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModulesPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_modules").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async ({ key, patch }: { key: string; patch: TablesUpdate<"site_modules"> }) => {
      const { error } = await supabase.from("site_modules").update(patch).eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-modules"] });
      void qc.invalidateQueries({ queryKey: ["modules"] });
    },
  });

  return (
    <ul className="divide-y divide-border border-y border-border">
      {(data ?? []).map((m) => (
        <li key={m.key} className="grid gap-4 py-6 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="space-y-3">
            <input
              defaultValue={m.name}
              onBlur={(e) => update.mutate({ key: m.key, patch: { name: e.target.value } })}
              className={input}
            />
            <textarea
              defaultValue={m.description}
              rows={2}
              onBlur={(e) => update.mutate({ key: m.key, patch: { description: e.target.value } })}
              className={input}
            />
          </div>
          <button
            onClick={() => update.mutate({ key: m.key, patch: { enabled: !m.enabled } })}
            className={`h-fit border px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] ${
              m.enabled ? "border-foreground bg-foreground text-background" : "border-input"
            }`}
          >
            {m.enabled ? "Activo" : "Inactivo"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlansPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("token_plans").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"token_plans"> }) => {
      const { error } = await supabase.from("token_plans").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Paquete actualizado.");
      void qc.invalidateQueries({ queryKey: ["admin-plans"] });
      void qc.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  return (
    <ul className="divide-y divide-border border-y border-border">
      {(data ?? []).map((p) => (
        <li key={p.id} className="grid gap-4 py-6 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-center">
          <input
            defaultValue={p.name}
            onBlur={(e) => update.mutate({ id: p.id, patch: { name: e.target.value } })}
            className={input}
          />
          <label className="text-xs">
            <span className="eyebrow">Tokens</span>
            <input
              type="number"
              min={1}
              defaultValue={p.tokens}
              onBlur={(e) => update.mutate({ id: p.id, patch: { tokens: Number(e.target.value) } })}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Precio (MXN)</span>
            <input
              type="number"
              min={0}
              defaultValue={p.price_cents / 100}
              onBlur={(e) =>
                update.mutate({
                  id: p.id,
                  patch: { price_cents: Math.round(Number(e.target.value) * 100) },
                })
              }
              className={input}
            />
          </label>
          <button
            onClick={() => update.mutate({ id: p.id, patch: { active: !p.active } })}
            className={`h-fit border px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] ${
              p.active ? "border-foreground bg-foreground text-background" : "border-input"
            }`}
          >
            {p.active ? "Activo" : "Inactivo"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: ledger } = await supabase.from("token_ledger").select("user_id, delta");
      const { data: waivers } = await supabase.from("waiver_signatures").select("user_id");
      const { data: bookings } = await supabase.from("bookings").select("user_id, status");

      const balances = new Map<string, number>();
      for (const row of ledger ?? []) {
        balances.set(row.user_id, (balances.get(row.user_id) ?? 0) + row.delta);
      }
      const signed = new Set((waivers ?? []).map((w) => w.user_id));
      const counts = new Map<string, number>();
      for (const b of bookings ?? []) {
        if (b.status === "reservada") counts.set(b.user_id, (counts.get(b.user_id) ?? 0) + 1);
      }

      return (profiles ?? []).map((p) => ({
        ...p,
        balance: balances.get(p.id) ?? 0,
        waiver: signed.has(p.id),
        active_bookings: counts.get(p.id) ?? 0,
      }));
    },
  });

  const adjust = useMutation({
    mutationFn: async ({ userId, delta }: { userId: string; delta: number }) => {
      const { error } = await supabase.rpc("admin_adjust_tokens", {
        _user_id: userId,
        _delta: delta,
        _reason: "Ajuste manual del estudio",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saldo actualizado.");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("No se pudo ajustar el saldo."),
  });

  return (
    <ul className="divide-y divide-border border-y border-border text-sm">
      {(data ?? []).map((u) => (
        <li key={u.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p>{u.full_name || "Sin nombre"}</p>
            <p className="text-muted-foreground">
              {u.email}
              {u.phone ? ` · ${u.phone}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-muted-foreground">
              {u.waiver ? "Waiver ✓" : "Sin waiver"} · {u.active_bookings} reservas
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => adjust.mutate({ userId: u.id, delta: -1 })}
                className="border border-input px-3 py-1.5"
                aria-label="Restar un token"
              >
                −
              </button>
              <span className="w-10 text-center text-lg">{u.balance}</span>
              <button
                onClick={() => adjust.mutate({ userId: u.id, delta: 1 })}
                className="border border-input px-3 py-1.5"
                aria-label="Sumar un token"
              >
                +
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LeadsPanel() {
  const { data } = useQuery({
    queryKey: ["admin-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <ul className="divide-y divide-border border-y border-border text-sm">
      {(data ?? []).length === 0 ? (
        <li className="py-6 text-muted-foreground">Sin mensajes por ahora.</li>
      ) : (
        (data ?? []).map((l) => (
          <li key={l.id} className="py-5">
            <div className="flex flex-wrap justify-between gap-3">
              <p>
                {l.name} · <span className="text-muted-foreground">{l.email}</span>
              </p>
              <span className="text-muted-foreground">
                {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                  new Date(l.created_at),
                )}
              </span>
            </div>
            <p className="mt-2 text-muted-foreground">{l.message}</p>
          </li>
        ))
      )}
    </ul>
  );
}

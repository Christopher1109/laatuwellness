import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  Stethoscope,
  ShoppingCart,
  Package,
  Users,
  UserCog,
  Wallet,
  Contact,
  LineChart,
  Tag,
  Home,
  PackageOpen,
  ScrollText,
  Ticket,
  
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell, type AdminNavGroup } from "@/components/admin/admin-shell";
import { AdminSchedulePanel } from "@/components/admin/schedule-calendar";
import { KardexPanel } from "@/components/admin/kardex-panel";
import {
  POSPanel,
  InventoryPanel,
  PendingOrdersPanel,
  StaffDirectoryPanel,
  CoachesPanel,
  ClientsPanel,
  PayrollPanel,
  PackagesPanel,
  CoachProfilePanel,
  FinancePanel,
  DashboardPanel,
  StaffHomePanel,
  CouponsPanel,

  MerchPanel,
  GoodesPanel,
  SchedulePlannerPanel,
  input,
} from "@/components/admin/ops-panels";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Panel del estudio — Läätu Wellness" },
      { name: "description", content: "Sistema administrativo de Läätu Wellness." },
    ],
  }),
  component: Admin,
});

// Horarios de clase (Reformer, Contrast Therapy...) viven separados de los
// horarios de consultorio (fisioterapia, psicología, nutrición) para que no
// se mezclen en la misma lista.
const CONSULTORIO_MODULES = ["nutricion", "psicologia", "rehabilitacion"] as const;

// Bloques de entrada en "Horarios de clases": se elige un programa y solo se
// muestran sus clases.
const CLASS_MODULE_BLOCKS = [
  { key: "reformer", label: "Reformer Studio", desc: "Clases de reformer" },
  { key: "4mat", label: "Format", desc: "Clases de 4mat / Format" },
  { key: "rehabilitacion", label: "Consultorio DorisFisio", desc: "Sesiones de fisioterapia" },
  { key: "contraste", label: "Contrast Therapy", desc: "Sauna y frío" },
] as const;

function ClassModulePicker({ onPick }: { onPick: (key: string) => void }) {
  return (
    <div>
      <h2 className="statement text-2xl">Horarios de clases</h2>
      <p className="mt-2 text-sm text-muted-foreground">Elige un programa para ver su agenda.</p>
      <div className="mt-6 grid gap-px bg-border sm:grid-cols-2">
        {CLASS_MODULE_BLOCKS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => onPick(b.key)}
            className="bg-background p-8 text-left transition-colors hover:bg-muted"
          >
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <p className="mt-4 text-lg">{b.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{b.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function Admin() {
  const { isAdmin, isStaff, isCoach, loading, staffProfile } = useAuth();

  const groups: AdminNavGroup[] = isAdmin
    ? [
        {
          items: [{ key: "inicio", label: "Inicio", icon: Home }],
        },
        {
          label: "Operación",
          items: [
            { key: "programacion", label: "Programación de clases", icon: CalendarDays },
            { key: "horarios-clases", label: "Horarios de clases", icon: CalendarDays },
            { key: "horarios-consultorio", label: "Horarios de consultorio", icon: Stethoscope },
            { key: "pos", label: "Punto de venta", icon: ShoppingCart },
            { key: "pedidos", label: "Pedidos pendientes", icon: PackageOpen },
            { key: "inventario", label: "Inventario", icon: Package },
          ],
        },
        {
          label: "Personas",
          items: [
            { key: "clientes", label: "Clientes", icon: Contact },
            { key: "staff", label: "Staff", icon: UserCog },
            { key: "coaches", label: "Coaches", icon: Users },
            { key: "nomina", label: "Nómina", icon: Wallet },
          ],
        },
        {
          label: "Negocio",
          items: [
            { key: "paquetes", label: "Paquetes", icon: Tag },
            { key: "merch", label: "Merch", icon: PackageOpen },
            { key: "goodes", label: "Goodes", icon: Tag },
            { key: "cupones", label: "Cupones", icon: Ticket },
            { key: "finanzas", label: "Finanzas", icon: LineChart },
            { key: "kardex", label: "Kardex", icon: ScrollText },
          ],
        },
      ]
    : isCoach
      ? [
          {
            items: [{ key: "mi-perfil", label: "Mi perfil", icon: Users }],
          },
        ]
      : isStaff
        ? [
            {
              items: [{ key: "inicio", label: "Inicio", icon: Home }],
            },
            {
              label: "Operación",
              items: [
                { key: "horarios-clases", label: "Horarios de clases", icon: CalendarDays },
                {
                  key: "horarios-consultorio",
                  label: "Horarios de consultorio",
                  icon: Stethoscope,
                },
                { key: "pos", label: "Punto de venta", icon: ShoppingCart },
                { key: "pedidos", label: "Pedidos pendientes", icon: PackageOpen },
                { key: "inventario", label: "Inventario", icon: Package },
              ],
            },
            {
              label: "Negocio",
              items: [
                { key: "clientes", label: "Clientes", icon: Contact },
                { key: "paquetes", label: "Paquetes", icon: Tag },
                { key: "cupones", label: "Cupones", icon: Ticket },
              ],
            },
          ]
        : [];

  const firstKey = groups[0]?.items[0]?.key ?? "";
  const [active, setActive] = useState(firstKey);
  const [focusModule, setFocusModule] = useState<string | null>(null);
  const [classModule, setClassModule] = useState<string | null>(null);

  const activeKey =
    active === "panel-staff" || groups.flatMap((g) => g.items).some((i) => i.key === active)
      ? active
      : firstKey;


  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Cargando…</div>;
  }

  if (!isAdmin && !isStaff) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 text-center">
        <h1 className="statement text-3xl">Acceso restringido</h1>
        <p className="mt-4 text-muted-foreground">
          Esta sección es solo para el equipo del estudio.
        </p>
      </div>
    );
  }

  return (
    <AdminShell
      groups={groups}
      active={activeKey}
      onSelect={(k) => {
        setFocusModule(null);
        setActive(k);
      }}

      title="Panel del estudio"
      subtitle={staffProfile?.role}
    >
      {activeKey === "inicio" ? (
        isAdmin ? (
          <DashboardPanel
            onGoTo={(key, moduleKey) => {
              setFocusModule(moduleKey ?? null);
              setActive(key);
            }}
          />
        ) : (
          <StaffHomePanel
            onGoTo={(key, moduleKey) => {
              setFocusModule(moduleKey ?? null);
              setActive(key);
            }}
          />
        )
      ) : null}
      {activeKey === "panel-staff" ? (
        <StaffHomePanel
          onGoTo={(key, moduleKey) => {
            setFocusModule(moduleKey ?? null);
            setActive(key);
          }}
        />
      ) : null}

      {activeKey === "programacion" ? <SchedulePlannerPanel /> : null}
      {activeKey === "horarios-clases" ? (
        (() => {
          const current = focusModule ?? classModule;
          if (!current) {
            return (
              <ClassModulePicker
                onPick={(k) => setClassModule(k)}
              />
            );
          }
          const label =
            CLASS_MODULE_BLOCKS.find((b) => b.key === current)?.label ?? "Horarios de clases";
          return (
            <div>
              <button
                type="button"
                onClick={() => {
                  setFocusModule(null);
                  setClassModule(null);
                }}
                className="mb-4 border border-input px-4 py-2 text-[0.66rem] uppercase tracking-[0.16em] transition-colors hover:bg-foreground hover:text-background"
              >
                ← Todos los programas
              </button>
              <AdminSchedulePanel modules={[current]} title={label} />
            </div>
          );
        })()
      ) : null}

      {activeKey === "horarios-consultorio" ? (
        <AdminSchedulePanel modules={[...CONSULTORIO_MODULES]} title="Horarios de consultorio" />
      ) : null}
      {activeKey === "pos" ? <POSPanel /> : null}
      
      {activeKey === "pedidos" ? <PendingOrdersPanel /> : null}
      {activeKey === "inventario" ? <InventoryPanel /> : null}
      {activeKey === "clientes" ? <ClientsPanel /> : null}
      {activeKey === "staff" ? <StaffDirectoryPanel /> : null}
      {activeKey === "coaches" ? <CoachesPanel /> : null}
      {activeKey === "nomina" ? <PayrollPanel /> : null}
      {activeKey === "paquetes" ? <PackagesPanel readOnly={!isAdmin} /> : null}
      {activeKey === "merch" ? <MerchPanel /> : null}
      {activeKey === "goodes" ? <GoodesPanel /> : null}
      {activeKey === "cupones" ? <CouponsPanel readOnly={!isAdmin} /> : null}
      {activeKey === "finanzas" ? <FinancePanel /> : null}
      {activeKey === "kardex" ? <KardexPanel /> : null}
      {activeKey === "mi-perfil" ? <CoachProfilePanel /> : null}
    </AdminShell>
  );
}

// ============================================================================
// HORARIOS (clases o consultorio, según `modules`) — tabla alineada,
// agrupada por día.
// ============================================================================
const MODULE_LABELS: Record<string, string> = {
  reformer: "Reformer Studio",
  "4mat": "4mat",
  contraste: "Contrast Therapy",
  nutricion: "Nutrición",
  psicologia: "Psicología",
  rehabilitacion: "DorisFisio",
};

function ClassesPanel({ modules, title }: { modules: string[]; title: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-classes", modules.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .in("module_key", modules)
        .order("starts_at")
        .limit(300);
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
      toast.success("Agregado.");
      void qc.invalidateQueries({ queryKey: ["admin-classes"] });
      void qc.invalidateQueries({ queryKey: ["classes"] });
    },
    onError: () => toast.error("No se pudo crear."),
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
      toast.success("Eliminado.");
      void qc.invalidateQueries({ queryKey: ["admin-classes"] });
      void qc.invalidateQueries({ queryKey: ["classes"] });
    },
    onError: () => toast.error("No se pudo eliminar (¿tiene reservas?)."),
  });

  const byDay = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof data>>();
    for (const c of data ?? []) {
      const key = new Intl.DateTimeFormat("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(new Date(c.starts_at));
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return Array.from(groups.entries());
  }, [data]);

  return (
    <div>
      <details className="mb-6 border border-border p-6" open={(data ?? []).length === 0}>
        <summary className="cursor-pointer eyebrow">Agregar a {title.toLowerCase()}</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const local = String(f.get("starts_at"));
            if (!local) return;
            create.mutate({
              module_key: String(f.get("module_key") || modules[0]),
              room: String(f.get("room") || ""),
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
            <select name="module_key" defaultValue={modules[0]} className={input}>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Salón / consultorio</span>
            <input name="room" placeholder="Reformer / Consultorio 1" className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Instructora / especialista</span>
            <input name="instructor" className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Fecha y hora</span>
            <input name="starts_at" type="datetime-local" required className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Duración (min)</span>
            <input
              name="duration_min"
              type="number"
              min={10}
              max={180}
              defaultValue={50}
              className={input}
            />
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
          <div className="sm:col-span-3 lg:col-span-6">
            <button className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
              Agregar
            </button>
          </div>
        </form>
      </details>

      <div className="space-y-3">
        {byDay.map(([day, items]) => (
          <details key={day} className="border border-border" open>
            <summary className="cursor-pointer border-b border-border px-4 py-3 text-sm capitalize">
              {day} <span className="text-muted-foreground">· {items.length}</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-4 py-2">Hora</th>
                    <th className="px-4 py-2">Salón / consultorio</th>
                    <th className="px-4 py-2">Programa</th>
                    <th className="px-4 py-2">Instructora / especialista</th>
                    <th className="px-4 py-2">Cupo</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("es-MX", { timeStyle: "short" }).format(
                          new Date(c.starts_at),
                        )}
                      </td>
                      <td className="px-4 py-3">{c.room}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {MODULE_LABELS[c.module_key ?? ""] ?? c.module_key}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.instructor}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.capacity}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                            className="border border-input px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em]"
                          >
                            {c.active ? "Ocultar" : "Publicar"}
                          </button>
                          <button
                            onClick={() => remove.mutate(c.id)}
                            className="border border-input px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] text-destructive"
                          >
                            Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
        {byDay.length === 0 ? (
          <p className="text-muted-foreground">Sin horarios todavía en {title.toLowerCase()}.</p>
        ) : null}
      </div>
    </div>
  );
}

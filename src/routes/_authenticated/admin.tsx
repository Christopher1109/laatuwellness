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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell, type AdminNavGroup } from "@/components/admin/admin-shell";
import { AdminSchedulePanel } from "@/components/admin/schedule-calendar";
import {
  POSPanel,
  InventoryPanel,
  StaffDirectoryPanel,
  CoachesPanel,
  ClientsPanel,
  PayrollPanel,
  PackagesPanel,
  CoachProfilePanel,
  FinancePanel,
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
const CLASS_MODULES = ["reformer", "salon-2", "contraste"] as const;
const CONSULTORIO_MODULES = ["nutricion", "psicologia", "rehabilitacion"] as const;

function Admin() {
  const { isAdmin, isStaff, isCoach, loading, staffProfile } = useAuth();

  const groups: AdminNavGroup[] = isAdmin
    ? [
        {
          label: "Operación",
          items: [
            { key: "horarios-clases", label: "Horarios de clases", icon: CalendarDays },
            { key: "horarios-consultorio", label: "Horarios de consultorio", icon: Stethoscope },
            { key: "pos", label: "Punto de venta", icon: ShoppingCart },
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
            { key: "finanzas", label: "Finanzas", icon: LineChart },
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
              items: [
                { key: "pos", label: "Punto de venta", icon: ShoppingCart },
                { key: "inventario", label: "Inventario", icon: Package },
              ],
            },
          ]
        : [];

  const firstKey = groups[0]?.items[0]?.key ?? "";
  const [active, setActive] = useState(firstKey);
  const activeKey = groups.flatMap((g) => g.items).some((i) => i.key === active)
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
      onSelect={setActive}
      title="Panel del estudio"
      subtitle={staffProfile?.role}
    >
      {activeKey === "horarios-clases" ? (
        <AdminSchedulePanel modules={[...CLASS_MODULES]} title="Horarios de clases" />
      ) : null}
      {activeKey === "horarios-consultorio" ? (
        <AdminSchedulePanel modules={[...CONSULTORIO_MODULES]} title="Horarios de consultorio" />
      ) : null}
      {activeKey === "pos" ? <POSPanel /> : null}
      {activeKey === "inventario" ? <InventoryPanel /> : null}
      {activeKey === "clientes" ? <ClientsPanel /> : null}
      {activeKey === "staff" ? <StaffDirectoryPanel /> : null}
      {activeKey === "coaches" ? <CoachesPanel /> : null}
      {activeKey === "nomina" ? <PayrollPanel /> : null}
      {activeKey === "paquetes" ? <PackagesPanel /> : null}
      {activeKey === "finanzas" ? <FinancePanel /> : null}
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
  "salon-2": "Segundo Salón",
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

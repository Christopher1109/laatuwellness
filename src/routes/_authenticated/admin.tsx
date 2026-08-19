import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  ShoppingCart,
  Package,
  UserCheck,
  Users,
  UserCog,
  Wallet,
  CalendarRange,
  Clock,
  Contact,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell, type AdminNavGroup } from "@/components/admin/admin-shell";
import {
  POSPanel,
  InventoryPanel,
  CheckInPanel,
  StaffDirectoryPanel,
  ClientsPanel,
  PayrollPanel,
  ShiftSchedulePanel,
  MyAvailabilityPanel,
  TimeClockPanel,
  CoachProfilePanel,
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

function Admin() {
  const { isAdmin, isStaff, isCoach, loading, staffProfile } = useAuth();

  const groups: AdminNavGroup[] = isAdmin
    ? [
        {
          label: "Operación",
          items: [
            { key: "horarios", label: "Horarios", icon: CalendarDays },
            { key: "checkin", label: "Check-in", icon: UserCheck },
            { key: "pos", label: "Punto de venta", icon: ShoppingCart },
            { key: "inventario", label: "Inventario", icon: Package },
          ],
        },
        {
          label: "Personas",
          items: [
            { key: "clientes", label: "Clientes", icon: Contact },
            { key: "staff", label: "Staff", icon: UserCog },
            { key: "nomina", label: "Nómina", icon: Wallet },
            { key: "turnos", label: "Turnos", icon: CalendarRange },
          ],
        },
        {
          label: "Mi cuenta",
          items: [{ key: "checador", label: "Checador", icon: Clock }],
        },
      ]
    : isCoach
      ? [
          {
            items: [
              { key: "mi-perfil", label: "Mi perfil", icon: Users },
              { key: "checador", label: "Checador", icon: Clock },
              { key: "disponibilidad", label: "Mi disponibilidad", icon: CalendarRange },
            ],
          },
        ]
      : isStaff
        ? [
            {
              items: [
                { key: "checkin", label: "Check-in", icon: UserCheck },
                { key: "pos", label: "Punto de venta", icon: ShoppingCart },
                { key: "inventario", label: "Inventario", icon: Package },
                { key: "checador", label: "Checador", icon: Clock },
                { key: "disponibilidad", label: "Mi disponibilidad", icon: CalendarRange },
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
      {activeKey === "horarios" ? <ClassesPanel /> : null}
      {activeKey === "checkin" ? <CheckInPanel /> : null}
      {activeKey === "pos" ? <POSPanel /> : null}
      {activeKey === "inventario" ? <InventoryPanel /> : null}
      {activeKey === "clientes" ? <ClientsPanel /> : null}
      {activeKey === "staff" ? <StaffDirectoryPanel /> : null}
      {activeKey === "nomina" ? <PayrollPanel /> : null}
      {activeKey === "turnos" ? <ShiftSchedulePanel /> : null}
      {activeKey === "disponibilidad" ? <MyAvailabilityPanel /> : null}
      {activeKey === "checador" ? <TimeClockPanel /> : null}
      {activeKey === "mi-perfil" ? <CoachProfilePanel /> : null}
    </AdminShell>
  );
}

// ============================================================================
// HORARIOS (clases) — agrupado por día, colapsable
// ============================================================================
function ClassesPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-classes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
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

  const byDay = useMemo(() => {
    const groups = new Map<string, typeof data>();
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
        <summary className="cursor-pointer eyebrow">Agregar clase</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-6"
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
      </details>

      <div className="space-y-3">
        {byDay.map(([day, classes]) => (
          <details key={day} className="border border-border" open>
            <summary className="cursor-pointer border-b border-border px-4 py-3 text-sm capitalize">
              {day} <span className="text-muted-foreground">· {classes?.length}</span>
            </summary>
            <ul className="divide-y divide-border text-sm">
              {(classes ?? []).map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="w-16">
                    {new Intl.DateTimeFormat("es-MX", { timeStyle: "short" }).format(
                      new Date(c.starts_at),
                    )}
                  </span>
                  <span>{c.room}</span>
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                    {c.module_key}
                  </span>
                  <span className="text-muted-foreground">{c.instructor}</span>
                  <span className="text-muted-foreground">Cupo {c.capacity}</span>
                  <div className="flex gap-2">
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
          </details>
        ))}
        {byDay.length === 0 ? <p className="text-muted-foreground">Sin clases todavía.</p> : null}
      </div>
    </div>
  );
}

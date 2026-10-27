import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { describeError } from "@/lib/describe-error";
import { coachSwatch } from "@/lib/coach-colors";
import { ScheduleHourEntry } from "@/components/admin/schedule-hour-entry";
import { Popout, input } from "@/components/admin/ops-panels";

// ============================================================================
// Programación de clases: plantilla semanal tipo hoja de cálculo. Cada bloque
// (hora x día) tiene coach, tipo de clase, cupo y, si hace falta, una hora
// real distinta a la del renglón (ej. renglón 8:00 → clase 8:15). Al publicar
// se generan las clases reales del periodo elegido.
// ============================================================================

const SCHEDULE_MODULES = [
  { key: "reformer", label: "Reformer" },
  { key: "4mat", label: "4mat" },
  { key: "rehabilitacion", label: "Consultorio (DorisFisio)" },
  { key: "contraste", label: "Contrast Therapy" },
] as const;

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

// Colores de respaldo para coaches que todavía no tienen color propio.
const FALLBACK_COLORS = [
  "#F4C2C2",
  "#BFDDF2",
  "#F7E2A8",
  "#C9E8C9",
  "#DCCFF4",
  "#F7D3B5",
  "#BDE3DE",
];

type TemplateRow = {
  id: string;
  module_key: string;
  weekday: number;
  start_time: string;
  actual_start: string | null;
  coach_id: string | null;
  class_type_id: string | null;
  is_rotation: boolean;
  is_tbd: boolean;
  active: boolean;
  room: string;
  capacity: number;
  duration_min: number;
};

type TemplatePatch = Partial<
  Pick<
    TemplateRow,
    | "coach_id"
    | "class_type_id"
    | "is_rotation"
    | "is_tbd"
    | "capacity"
    | "duration_min"
    | "actual_start"
  >
>;

type CoachOption = { id: string; full_name: string; color: string | null };
type ClassTypeOption = {
  id: string;
  name: string;
  default_capacity: number | null;
  active: boolean;
  module_key: string;
};

/** Pincel de asignación rápida. */
type Brush =
  | { kind: "coach"; id: string }
  | { kind: "rotation" }
  | { kind: "pending" }
  | { kind: "tbd" }
  | { kind: "type"; id: string | null };

function startOfIsoWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const iso = (x.getDay() + 6) % 7; // 0 = lunes
  x.setDate(x.getDate() - iso);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

function moduleDefaults(moduleKey: string) {
  return {
    capacity: moduleKey === "rehabilitacion" ? 1 : 10,
    duration_min: moduleKey === "rehabilitacion" ? 40 : 50,
  };
}

const isPublished = (t: Pick<TemplateRow, "coach_id" | "is_rotation" | "is_tbd">) =>
  Boolean(t.coach_id) || t.is_rotation || t.is_tbd;

export function SchedulePlannerPanel() {
  const qc = useQueryClient();
  const { isAdmin, isStaff, isCoach } = useAuth();
  // Administración y recepción pueden corregir nombres y cupos de los tipos.
  const canEditTypes = isAdmin || (isStaff && !isCoach);
  const [moduleKey, setModuleKey] = useState<string>("reformer");
  const [editingCell, setEditingCell] = useState<{ weekday: number; time: string } | null>(null);
  const [extraTimes, setExtraTimes] = useState<string[]>([]);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [publishScope, setPublishScope] = useState<"week" | "month" | "until">("week");
  const [publishUntil, setPublishUntil] = useState("");
  const [weekCursor, setWeekCursor] = useState<Date>(() => startOfIsoWeek(new Date()));

  const now = new Date();
  const weekStart = startOfIsoWeek(weekCursor);
  // La semana pertenece al mes de su lunes.
  const monthCursor = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  const monthKey = ymd(monthCursor);
  const prevMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
  const prevMonthKey = ymd(prevMonth);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ymd(weekStart)],
  );
  const isCurrentWeek = ymd(weekStart) === ymd(startOfIsoWeek(now));
  const monthLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(
    monthCursor,
  );
  const weekLabel = (() => {
    const f = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
    return `${f.format(weekDates[0]!)} – ${f.format(weekDates[6]!)}`;
  })();
  const goToWeek = (d: Date) => {
    setWeekCursor(startOfIsoWeek(d));
    setEditingCell(null);
  };

  const { data: templates } = useQuery({
    queryKey: ["schedule-templates", moduleKey, monthKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_templates")
        .select("*")
        .eq("module_key", moduleKey)
        .eq("month", monthKey)
        .order("start_time");
      if (error) throw error;
      return data as TemplateRow[];
    },
  });

  // Si el mes todavía no se programa, solo heredamos las HORAS del mes
  // anterior como punto de partida — los coaches quedan en blanco.
  const { data: prevTemplates } = useQuery({
    queryKey: ["schedule-templates", moduleKey, prevMonthKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_templates")
        .select("start_time")
        .eq("module_key", moduleKey)
        .eq("month", prevMonthKey)
        .order("start_time");
      if (error) throw error;
      return data as { start_time: string }[];
    },
  });

  const { data: coaches } = useQuery({
    queryKey: ["schedule-planner-coaches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name, color")
        .eq("role", "coach")
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return data as CoachOption[];
    },
  });

  const { data: classTypes } = useQuery({
    queryKey: ["schedule-class-types", moduleKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_types")
        .select("id, name, default_capacity, active, module_key")
        .eq("module_key", moduleKey)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as ClassTypeOption[];
    },
  });
  const activeTypes = useMemo(() => (classTypes ?? []).filter((t) => t.active), [classTypes]);

  // Visibilidad del programa en la web/app (site_modules.enabled)
  const { data: siteModule } = useQuery({
    queryKey: ["schedule-site-module", moduleKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_modules")
        .select("key, name, enabled")
        .eq("key", moduleKey)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggleVisible = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("site_modules")
        .update({ enabled })
        .eq("key", moduleKey);
      if (error) throw error;
    },
    onSuccess: (_d, enabled) => {
      toast.success(
        enabled
          ? "Programa visible en la página y la app."
          : "Programa oculto: ya no se muestra ni se puede reservar.",
      );
      void qc.invalidateQueries({ queryKey: ["schedule-site-module", moduleKey] });
      void qc.invalidateQueries({ queryKey: ["site-modules"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cambiar la visibilidad."),
  });

  // Días cerrados (blackouts) del módulo
  const { data: blackouts } = useQuery({
    queryKey: ["schedule-blackouts", moduleKey],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
      const { data, error } = await (supabase.from as any)("schedule_blackouts")
        .select("id, day")
        .eq("module_key", moduleKey);
      if (error) throw error;
      return data as { id: string; day: string }[];
    },
  });
  const blackoutSet = useMemo(() => new Set((blackouts ?? []).map((b) => b.day)), [blackouts]);

  // Bloques bloqueados solo en una semana (día + hora puntual).
  const weekFrom = ymd(weekDates[0]!);
  const weekTo = ymd(weekDates[6]!);
  const { data: slotBlocks } = useQuery({
    queryKey: ["schedule-slot-blocks", moduleKey, weekFrom],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
      const { data, error } = await (supabase.from as any)("schedule_slot_blocks")
        .select("day, start_time")
        .eq("module_key", moduleKey)
        .gte("day", weekFrom)
        .lte("day", weekTo);
      if (error) throw error;
      return data as { day: string; start_time: string }[];
    },
  });
  const slotBlockSet = useMemo(
    () => new Set((slotBlocks ?? []).map((b) => `${b.day}|${b.start_time.slice(0, 5)}`)),
    [slotBlocks],
  );

  const invalidateClasses = () => {
    void qc.invalidateQueries({ queryKey: ["admin-classes"] });
    void qc.invalidateQueries({ queryKey: ["admin-schedule-classes"] });
    void qc.invalidateQueries({ queryKey: ["classes"] });
  };

  const setSlotBlock = useMutation({
    mutationFn: async (v: { day: string; time: string; blocked: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función fuera de los tipos generados
      const { data, error } = await (supabase.rpc as any)("set_schedule_slot_block", {
        _module_key: moduleKey,
        _day: v.day,
        _start_time: v.time,
        _blocked: v.blocked,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (cancelled, v) => {
      setEditingCell(null);
      toast.success(
        v.blocked
          ? `Bloque bloqueado solo ese día.${cancelled > 0 ? ` Se cancelaron ${cancelled} reserva(s) y se regresaron sus créditos.` : ""}`
          : "Bloque reabierto para ese día.",
      );
      void qc.invalidateQueries({ queryKey: ["schedule-slot-blocks", moduleKey] });
      invalidateClasses();
    },
    onError: (e) => toast.error(describeError(e, "No se pudo bloquear el bloque.")),
  });

  const toggleBlackout = useMutation({
    mutationFn: async (day: string) => {
      if (blackoutSet.has(day)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
        const { error } = await (supabase.from as any)("schedule_blackouts")
          .delete()
          .eq("module_key", moduleKey)
          .eq("day", day);
        if (error) throw error;
        return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
      const { error } = await (supabase.from as any)("schedule_blackouts").insert({
        module_key: moduleKey,
        day,
      });
      if (error) throw error;
      return true;
    },
    onSuccess: (closed) => {
      toast.success(
        closed
          ? 'Día bloqueado. Dale a "Actualizar clases" para quitarlo de la página.'
          : 'Día reabierto. Dale a "Actualizar clases" para publicarlo.',
      );
      void qc.invalidateQueries({ queryKey: ["schedule-blackouts", moduleKey] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo bloquear el día."),
  });

  const coachById = useMemo(() => new Map((coaches ?? []).map((c) => [c.id, c])), [coaches]);
  const typeById = useMemo(() => new Map((classTypes ?? []).map((t) => [t.id, t])), [classTypes]);
  const coachColor = (id: string | null) => {
    if (!id) return null;
    const c = coachById.get(id);
    if (c?.color) return c.color;
    const idx = (coaches ?? []).findIndex((x) => x.id === id);
    return FALLBACK_COLORS[(idx < 0 ? 0 : idx) % FALLBACK_COLORS.length]!;
  };

  // Horas que solo se muestran heredadas del mes anterior (aún no guardadas).
  const inheritedTimes = useMemo(
    () =>
      (templates ?? []).length === 0
        ? Array.from(new Set((prevTemplates ?? []).map((t) => hhmm(t.start_time))))
        : [],
    [templates, prevTemplates],
  );

  const times = useMemo(() => {
    const own = (templates ?? []).map((t) => hhmm(t.start_time));
    return Array.from(new Set([...own, ...inheritedTimes, ...extraTimes])).sort();
  }, [templates, inheritedTimes, extraTimes]);

  const moduleRoom = SCHEDULE_MODULES.find((m) => m.key === moduleKey)?.label ?? "";
  const baseRow = (weekday: number, time: string, month: string) => ({
    module_key: moduleKey,
    weekday,
    start_time: `${time}:00`,
    month,
    coach_id: null as string | null,
    class_type_id: null as string | null,
    is_rotation: false,
    is_tbd: false,
    actual_start: null as string | null,
    active: false,
    room: moduleRoom,
    ...moduleDefaults(moduleKey),
  });

  // Antes de guardar el primer bloque de un mes nuevo, se guardan como
  // "Pendiente" todas las horas heredadas; si no, al asignar la primera
  // persona desaparecían las demás horas de la cuadrícula.
  const materializeInherited = async () => {
    const pending = [...inheritedTimes, ...extraTimes];
    if ((templates ?? []).length > 0 || pending.length === 0) return;
    const rows = pending.flatMap((time) =>
      Array.from({ length: 7 }, (_, weekday) => baseRow(weekday, time, monthKey)),
    );
    const { error } = await supabase.from("schedule_templates").upsert(rows, {
      onConflict: "module_key,weekday,start_time,month",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  };

  const cellFor = (weekday: number, time: string) =>
    (templates ?? []).find((t) => t.weekday === weekday && hhmm(t.start_time) === time);

  const invalidateTemplates = () =>
    void qc.invalidateQueries({ queryKey: ["schedule-templates", moduleKey, monthKey] });

  const saveCell = useMutation({
    mutationFn: async (v: { weekday: number; time: string; patch: TemplatePatch }) => {
      await materializeInherited();
      const { data: found, error: findError } = await supabase
        .from("schedule_templates")
        .select("*")
        .eq("module_key", moduleKey)
        .eq("month", monthKey)
        .eq("weekday", v.weekday)
        .eq("start_time", `${v.time}:00`)
        .maybeSingle();
      if (findError) throw findError;
      const merged = { ...baseRow(v.weekday, v.time, monthKey), ...(found ?? {}), ...v.patch };
      const active = isPublished(merged);
      if (found) {
        const { error } = await supabase
          .from("schedule_templates")
          .update({ ...v.patch, active })
          .eq("id", (found as TemplateRow).id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("schedule_templates")
          .insert({ ...baseRow(v.weekday, v.time, monthKey), ...v.patch, active });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEditingCell(null);
      setExtraTimes([]);
      invalidateTemplates();
    },
    onError: (e: Error) => toast.error(describeError(e, "No se pudo guardar el bloque.")),
  });

  const removeCell = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedule_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingCell(null);
      invalidateTemplates();
    },
  });

  const addTimeRow = useMutation({
    mutationFn: async (time: string) => {
      await materializeInherited();
      const rows = Array.from({ length: 7 }, (_, weekday) => baseRow(weekday, time, monthKey));
      const { error } = await supabase.from("schedule_templates").upsert(rows, {
        onConflict: "module_key,weekday,start_time,month",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    },
    onSuccess: (_d, time) => {
      setExtraTimes((prev) => prev.filter((t) => t !== time));
      toast.success("Renglón de hora guardado.");
      invalidateTemplates();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar la hora."),
  });

  const removeTimeRow = useMutation({
    mutationFn: async (time: string) => {
      const { error } = await supabase
        .from("schedule_templates")
        .delete()
        .eq("module_key", moduleKey)
        .eq("month", monthKey)
        .eq("start_time", `${time}:00`);
      if (error) throw error;
    },
    onSuccess: (_d, time) => {
      setEditingCell(null);
      setExtraTimes((prev) => prev.filter((t) => t !== time));
      toast.success("Hora eliminada del patrón.");
      invalidateTemplates();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar la hora."),
  });

  // Tipos de clase del programa (solo administración los da de alta).
  const saveType = useMutation({
    mutationFn: async (v: ClassTypeSave) => {
      const name = (v.name ?? "").trim().slice(0, 60);
      if (v.id) {
        if (v.name !== undefined && !name) throw new Error("El nombre no puede ir vacío.");
        const duplicated = (classTypes ?? []).some(
          (t) => t.id !== v.id && t.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (name && duplicated) throw new Error("Ya existe otro tipo de clase con ese nombre.");
        const patch: { name?: string; default_capacity: number | null; active?: boolean } = {
          default_capacity: v.default_capacity,
        };
        if (name) patch.name = name;
        if (v.active !== undefined) patch.active = v.active;
        const { data, error } = await supabase
          .from("class_types")
          .update(patch)
          .eq("id", v.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0)
          throw new Error("No tienes permiso para editar tipos de clase.");
      } else {
        if (!name) throw new Error("Escribe el nombre del tipo de clase.");
        if ((classTypes ?? []).some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
          throw new Error("Ya existe un tipo de clase con ese nombre.");
        }
        const { error } = await supabase.from("class_types").insert({
          module_key: moduleKey,
          name,
          description: "",
          default_capacity: v.default_capacity,
          active: true,
          sort_order: (classTypes ?? []).length,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Tipo de clase guardado. Ya se ve así en la página y la app.");
      void qc.invalidateQueries({ queryKey: ["schedule-class-types", moduleKey] });
      void qc.invalidateQueries({ queryKey: ["class-types"] });
      void qc.invalidateQueries({ queryKey: ["public-class-types"] });
    },
    onError: (e: Error) => toast.error(describeError(e, "No se pudo guardar el tipo de clase.")),
  });

  // Rango a publicar: solo la semana que se ve (default), el mes completo o
  // hasta una fecha. Nunca hacia atrás de hoy.
  const updateRange = useMemo(() => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from: Date;
    let to: Date;
    if (publishScope === "month") {
      from = monthCursor;
      to = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
    } else if (publishScope === "until" && publishUntil) {
      from = weekStart;
      const [y, m, d] = publishUntil.split("-").map(Number);
      to = new Date(y!, (m ?? 1) - 1, d ?? 1);
    } else {
      from = weekStart;
      to = addDays(weekStart, 6);
    }
    if (from < today) from = today;
    return { from, to, valid: to >= from };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, ymd(weekStart), publishScope, publishUntil]);

  const publish = useMutation({
    mutationFn: async () => {
      await materializeInherited();
      let touched = 0;
      let cursor = new Date(updateRange.from);
      while (cursor <= updateRange.to) {
        const segMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const segMonthKey = ymd(segMonth);
        const segEndOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const segEnd = segEndOfMonth < updateRange.to ? segEndOfMonth : updateRange.to;

        if (segMonthKey !== monthKey) {
          const { count, error: countError } = await supabase
            .from("schedule_templates")
            .select("id", { count: "exact", head: true })
            .eq("module_key", moduleKey)
            .eq("month", segMonthKey);
          if (countError) throw countError;
          // Fuera de "Hasta una fecha" no se llena un mes que todavía no se
          // programa; solo se omite esa parte para no borrar sus clases.
          if ((count ?? 0) === 0 && publishScope !== "until") {
            cursor = addDays(segEnd, 1);
            continue;
          }
          if ((count ?? 0) === 0) {
            const { data: source, error: sourceError } = await supabase
              .from("schedule_templates")
              .select(
                "weekday, start_time, actual_start, coach_id, class_type_id, is_rotation, is_tbd, active, room, capacity, duration_min",
              )
              .eq("module_key", moduleKey)
              .eq("month", monthKey);
            if (sourceError) throw sourceError;
            const copies = (source ?? []).map((t) => ({
              ...t,
              module_key: moduleKey,
              month: segMonthKey,
            }));
            if (copies.length > 0) {
              const { error: copyError } = await supabase
                .from("schedule_templates")
                .upsert(copies, {
                  onConflict: "module_key,weekday,start_time,month",
                  ignoreDuplicates: true,
                });
              if (copyError) throw copyError;
            }
          }
        }

        const { data, error } = await supabase.rpc("publish_schedule_range", {
          _module_key: moduleKey,
          _from: ymd(cursor),
          _to: ymd(segEnd),
        });
        if (error) throw error;
        touched += Number(data ?? 0);
        cursor = addDays(segEnd, 1);
      }
      return touched;
    },
    onSuccess: (touched) => {
      toast.success(`Listo: ${touched} clases actualizadas y visibles para reservar.`);
      void qc.invalidateQueries({ queryKey: ["schedule-templates", moduleKey] });
      invalidateClasses();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar."),
  });

  const rangeLabel = () => {
    const f = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
    return `${f.format(updateRange.from)} – ${f.format(updateRange.to)}`;
  };

  const brushPatch = (b: Brush): TemplatePatch => {
    switch (b.kind) {
      case "coach":
        return { coach_id: b.id, is_rotation: false, is_tbd: false };
      case "rotation":
        return { coach_id: null, is_rotation: true, is_tbd: false };
      case "tbd":
        return { coach_id: null, is_rotation: false, is_tbd: true };
      case "pending":
        return { coach_id: null, is_rotation: false, is_tbd: false };
      case "type": {
        const t = b.id ? typeById.get(b.id) : null;
        return {
          class_type_id: b.id,
          ...(t?.default_capacity ? { capacity: t.default_capacity } : {}),
        };
      }
    }
  };

  const brushLabel = (b: Brush) =>
    b.kind === "coach"
      ? (coachById.get(b.id)?.full_name ?? "")
      : b.kind === "rotation"
        ? "Rotación"
        : b.kind === "tbd"
          ? "Por definir"
          : b.kind === "pending"
            ? "Pendiente"
            : b.id
              ? `el tipo ${typeById.get(b.id)?.name ?? ""}`
              : "sin tipo de clase";

  const sameBrush = (a: Brush | null, b: Brush) =>
    Boolean(a) &&
    a!.kind === b.kind &&
    (a as { id?: string | null }).id === (b as { id?: string | null }).id;
  const toggleBrush = (b: Brush) => setBrush((cur) => (sameBrush(cur, b) ? null : b));

  const editing = editingCell ? cellFor(editingCell.weekday, editingCell.time) : undefined;
  const editingDate = editingCell ? weekDates[editingCell.weekday]! : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SCHEDULE_MODULES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setModuleKey(m.key);
              setExtraTimes([]);
              setEditingCell(null);
              setBrush(null);
            }}
            className={`border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] ${moduleKey === m.key ? "border-foreground bg-foreground text-background" : "border-input"}`}
          >
            {m.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "text-[0.62rem] uppercase tracking-[0.12em]",
              siteModule?.enabled === false ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {siteModule?.enabled === false ? "Oculto en la página" : "Visible en la página"}
          </span>
          <button
            type="button"
            disabled={!siteModule || toggleVisible.isPending}
            onClick={() => toggleVisible.mutate(!(siteModule?.enabled ?? true))}
            className="border border-input px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.12em] hover:bg-muted disabled:opacity-40"
          >
            {siteModule?.enabled === false ? "Mostrar" : "Ocultar"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 border border-border p-3">
        <button
          type="button"
          onClick={() => goToWeek(addDays(weekStart, -7))}
          className="border border-input px-3 py-1.5 text-xs hover:bg-muted"
          aria-label="Semana anterior"
        >
          ←
        </button>
        <div className="min-w-[12rem] text-center text-sm">
          <span className="eyebrow block text-[0.6rem]">
            Semana · <span className="capitalize">{monthLabel}</span>
          </span>
          <span className="capitalize">{weekLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => goToWeek(addDays(weekStart, 7))}
          className="border border-input px-3 py-1.5 text-xs hover:bg-muted"
          aria-label="Semana siguiente"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => goToWeek(new Date())}
          disabled={isCurrentWeek}
          className="border border-input px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted disabled:opacity-40"
        >
          Semana actual
        </button>
      </div>

      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Cada bloque lleva <strong>coach</strong> y <strong>tipo de clase</strong> por separado. "Por
        definir" publica la clase aunque todavía no haya coach (en la página se ve como "Coach por
        anunciar"); "Pendiente" la deja sin publicar. Toca un bloque para cambiar coach, tipo, cupo
        u hora real (por ejemplo 8:15 en el renglón de 8:00). Cuando termines, dale a "Actualizar
        clases". Para cambiar al coach de una sola clase (alguien la cubre) hazlo desde Horarios de
        clases: ese cambio se respeta aunque vuelvas a actualizar.
      </p>

      <div className="mb-3 space-y-3 border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Asignar coach</span>
          <button
            type="button"
            onClick={() => setBrush(null)}
            className={cn(
              "border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em]",
              brush === null
                ? "border-foreground bg-foreground text-background"
                : "border-input hover:bg-muted",
            )}
          >
            Apagada
          </button>
          {(coaches ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleBrush({ kind: "coach", id: c.id })}
              style={coachSwatch(coachColor(c.id))}
              className={cn(
                "px-3 py-1.5 text-[0.7rem] ring-offset-2 ring-offset-background",
                sameBrush(brush, { kind: "coach", id: c.id }) && "ring-2 ring-foreground",
              )}
            >
              {c.full_name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => toggleBrush({ kind: "tbd" })}
            className={cn(
              "border border-dashed border-amber-500 bg-amber-50 px-3 py-1.5 text-[0.7rem] text-amber-900 ring-offset-2 ring-offset-background",
              sameBrush(brush, { kind: "tbd" }) && "ring-2 ring-foreground",
            )}
          >
            Por definir
          </button>
          <button
            type="button"
            onClick={() => toggleBrush({ kind: "rotation" })}
            className={cn(
              "bg-slate-300 px-3 py-1.5 text-[0.7rem] text-slate-800 ring-offset-2 ring-offset-background",
              sameBrush(brush, { kind: "rotation" }) && "ring-2 ring-foreground",
            )}
          >
            Rotación
          </button>
          <button
            type="button"
            onClick={() => toggleBrush({ kind: "pending" })}
            className={cn(
              "border border-dashed border-input px-3 py-1.5 text-[0.7rem] text-muted-foreground ring-offset-2 ring-offset-background",
              sameBrush(brush, { kind: "pending" }) && "ring-2 ring-foreground",
            )}
          >
            Pendiente
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Asignar tipo de clase</span>
          {activeTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleBrush({ kind: "type", id: t.id })}
              className={cn(
                "border border-input px-3 py-1.5 text-[0.7rem] ring-offset-2 ring-offset-background hover:bg-muted",
                sameBrush(brush, { kind: "type", id: t.id }) && "ring-2 ring-foreground",
              )}
            >
              {t.name}
              {t.default_capacity ? (
                <span className="ml-1 text-muted-foreground">· cupo {t.default_capacity}</span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={() => toggleBrush({ kind: "type", id: null })}
            className={cn(
              "border border-dashed border-input px-3 py-1.5 text-[0.7rem] text-muted-foreground ring-offset-2 ring-offset-background",
              sameBrush(brush, { kind: "type", id: null }) && "ring-2 ring-foreground",
            )}
          >
            Sin tipo
          </button>
          {activeTypes.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Este programa todavía no tiene tipos de clase.
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {brush
            ? `Toca los bloques para asignar ${brushLabel(brush)}. Se guarda al instante; apágala para volver a editar bloque por bloque.`
            : "Elige un coach o un tipo de clase y toca los bloques para asignarlo uno por uno. El coach y el tipo se combinan: puedes pintar primero coaches y luego tipos."}
        </p>
      </div>

      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="w-20 px-3 py-2 text-left text-[0.65rem] uppercase text-muted-foreground">
                Hora
              </th>
              {WEEKDAY_LABELS.map((d, i) => {
                const date = weekDates[i]!;
                const isToday = ymd(date) === ymd(new Date());
                const inMonth = date.getMonth() === monthCursor.getMonth();
                const closed = blackoutSet.has(ymd(date));
                return (
                  <th
                    key={d}
                    className={cn(
                      "px-2 py-2 text-left text-[0.65rem] uppercase text-muted-foreground",
                      isToday && "text-foreground",
                      !inMonth && "opacity-40",
                      closed && "bg-destructive/10",
                    )}
                  >
                    <button
                      type="button"
                      title={closed ? "Reabrir este día" : "Bloquear este día (cerrado)"}
                      onClick={() => toggleBlackout.mutate(ymd(date))}
                      className="text-left hover:text-foreground"
                    >
                      <span className={cn(closed && "line-through")}>
                        {d}{" "}
                        <span className={cn("font-mono", isToday && "underline")}>
                          {date.getDate()}
                        </span>
                      </span>
                      <span className="block text-[0.55rem] normal-case tracking-normal text-muted-foreground">
                        {closed ? "Cerrado" : "Abierto"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time} className="border-b border-border last:border-0">
                <td className="px-3 py-1 font-mono text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span>{time}</span>
                    <button
                      type="button"
                      title="Eliminar esta hora del patrón"
                      onClick={() => {
                        if (window.confirm(`¿Eliminar la hora ${time} de todos los días?`)) {
                          removeTimeRow.mutate(time);
                        }
                      }}
                      className="px-1 text-sm leading-none text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  </div>
                </td>
                {WEEKDAY_LABELS.map((_, weekday) => {
                  const cell = cellFor(weekday, time);
                  const dayKey = ymd(weekDates[weekday]!);
                  const dayClosed = blackoutSet.has(dayKey);
                  const slotBlocked = slotBlockSet.has(`${dayKey}|${time}`);
                  const typeName = cell?.class_type_id
                    ? typeById.get(cell.class_type_id)?.name
                    : undefined;
                  const realTime =
                    cell?.actual_start && hhmm(cell.actual_start) !== time
                      ? hhmm(cell.actual_start)
                      : null;
                  const label = dayClosed
                    ? "Cerrado"
                    : slotBlocked
                      ? "Bloqueado"
                      : !cell
                        ? ""
                        : cell.is_rotation
                          ? "Rotación"
                          : cell.is_tbd
                            ? "Por definir"
                            : cell.coach_id
                              ? (coachById.get(cell.coach_id)?.full_name ?? "Coach")
                              : "Pendiente";
                  const coachStyle =
                    !dayClosed &&
                    !slotBlocked &&
                    cell?.coach_id &&
                    !cell.is_tbd &&
                    !cell.is_rotation
                      ? coachSwatch(coachColor(cell.coach_id))
                      : undefined;
                  return (
                    <td key={weekday} className="border-l border-border p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (brush && !dayClosed) {
                            saveCell.mutate({ weekday, time, patch: brushPatch(brush) });
                            return;
                          }
                          if (!dayClosed) setEditingCell({ weekday, time });
                        }}
                        style={coachStyle}
                        className={cn(
                          "flex h-14 w-full flex-col items-center justify-center overflow-hidden px-1 text-center text-[0.7rem] leading-tight transition-opacity hover:opacity-80",
                          !coachStyle && "bg-background text-muted-foreground",
                          cell?.is_rotation && "bg-slate-300 text-slate-800",
                          cell?.is_tbd &&
                            "border border-dashed border-amber-500 bg-amber-50 text-amber-900",
                          (dayClosed || slotBlocked) && "opacity-30 line-through",
                        )}
                        title={
                          slotBlocked
                            ? "Bloqueado solo ese día. Tócalo para desbloquear."
                            : undefined
                        }
                      >
                        <span className="font-medium">{label}</span>
                        {cell && !dayClosed && !slotBlocked && (typeName || realTime) ? (
                          <span className="mt-0.5 text-[0.6rem] opacity-80">
                            {[typeName, realTime ? `⏱ ${realTime}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {times.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Sin horas configuradas todavía para {moduleRoom} en este mes.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ScheduleHourEntry
        key={`${moduleKey}:${monthKey}`}
        times={times}
        pending={addTimeRow.isPending}
        onAdd={(time) => addTimeRow.mutate(time)}
      />

      {canEditTypes ? (
        <ClassTypesEditor
          moduleLabel={moduleRoom}
          types={classTypes ?? []}
          pending={saveType.isPending}
          onSave={(v) => saveType.mutate(v)}
        />
      ) : null}

      <div className="mt-8 border-t border-border pt-6">
        <p className="eyebrow mb-2">¿Hasta cuándo aplicar este horario?</p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(
            [
              ["week", "Solo esta semana"],
              ["month", "Todo el mes"],
              ["until", "Hasta una fecha"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPublishScope(key)}
              className={cn(
                "border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em]",
                publishScope === key
                  ? "border-foreground bg-foreground text-background"
                  : "border-input hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
          {publishScope === "until" ? (
            <input
              type="date"
              value={publishUntil}
              min={ymd(addDays(weekStart, 6))}
              onChange={(e) => setPublishUntil(e.target.value)}
              className={`${input} w-44`}
              aria-label="Aplicar hasta"
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => publish.mutate()}
          disabled={
            publish.isPending || !updateRange.valid || (publishScope === "until" && !publishUntil)
          }
          className="bg-foreground px-5 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
        >
          {publish.isPending ? "Actualizando…" : "Actualizar clases"}
        </button>
        <p className="max-w-md text-xs text-muted-foreground">
          {publishScope === "until" && !publishUntil
            ? "Elige la fecha hasta la que se repetirá este horario."
            : updateRange.valid
              ? `Se aplicará a las clases del ${rangeLabel()}. Las clientas las ven y reservan con una semana de anticipación.${
                  publishScope === "until"
                    ? " Si un mes dentro del rango todavía no tiene horario, se le copia el de este mes."
                    : ""
                } Fuera de ese periodo no se modifica nada.`
              : "Ese periodo ya pasó: muévete a la semana actual o a una futura para actualizar."}
        </p>
      </div>

      {editingCell && editingDate ? (
        <CellEditor
          key={`${editingCell.weekday}-${editingCell.time}-${editing?.id ?? "new"}`}
          time={editingCell.time}
          date={editingDate}
          cell={editing}
          coaches={coaches ?? []}
          types={activeTypes}
          defaults={moduleDefaults(moduleKey)}
          slotBlocked={slotBlockSet.has(`${ymd(editingDate)}|${editingCell.time}`)}
          pending={saveCell.isPending || setSlotBlock.isPending || removeCell.isPending}
          onClose={() => setEditingCell(null)}
          onSave={(patch) =>
            saveCell.mutate({ weekday: editingCell.weekday, time: editingCell.time, patch })
          }
          onBlock={(blocked) =>
            setSlotBlock.mutate({ day: ymd(editingDate), time: editingCell.time, blocked })
          }
          onRemove={() => {
            if (editing) removeCell.mutate(editing.id);
            else setEditingCell(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CellEditor({
  time,
  date,
  cell,
  coaches,
  types,
  defaults,
  slotBlocked,
  pending,
  onClose,
  onSave,
  onBlock,
  onRemove,
}: {
  time: string;
  date: Date;
  cell: TemplateRow | undefined;
  coaches: CoachOption[];
  types: ClassTypeOption[];
  defaults: { capacity: number; duration_min: number };
  slotBlocked: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: TemplatePatch) => void;
  onBlock: (blocked: boolean) => void;
  onRemove: () => void;
}) {
  const initialCoach = !cell
    ? "__pending"
    : cell.is_rotation
      ? "__rot"
      : cell.is_tbd
        ? "__tbd"
        : (cell.coach_id ?? "__pending");
  const [coach, setCoach] = useState(initialCoach);
  const [typeId, setTypeId] = useState(cell?.class_type_id ?? "");
  const [capacity, setCapacity] = useState(String(cell?.capacity ?? defaults.capacity));
  const [duration, setDuration] = useState(String(cell?.duration_min ?? defaults.duration_min));
  const [realTime, setRealTime] = useState(hhmm(cell?.actual_start) || time);

  const weekdayName = WEEKDAY_LABELS[(date.getDay() + 6) % 7]!.toLowerCase();
  const dayLabel = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);

  return (
    <Popout onClose={onClose}>
      <p className="eyebrow">
        Bloque de los {weekdayName} · {time}
      </p>
      <h3 className="statement mt-1 text-2xl">Editar bloque</h3>
      <form
        className="mt-5 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const cap = Math.max(1, Math.round(Number(capacity) || defaults.capacity));
          const dur = Math.max(10, Math.round(Number(duration) || defaults.duration_min));
          onSave({
            coach_id: coach.startsWith("__") ? null : coach,
            is_rotation: coach === "__rot",
            is_tbd: coach === "__tbd",
            class_type_id: typeId || null,
            capacity: cap,
            duration_min: dur,
            actual_start: realTime && realTime !== time ? `${realTime}:00` : null,
          });
        }}
      >
        <label className="text-xs">
          <span className="eyebrow">Coach</span>
          <select value={coach} onChange={(e) => setCoach(e.target.value)} className={input}>
            <option value="__pending">Pendiente (no se publica)</option>
            <option value="__tbd">Por definir (se publica como "Coach por anunciar")</option>
            <option value="__rot">Rotación de fin de semana</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="eyebrow">Tipo de clase</span>
          <select
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              const t = types.find((x) => x.id === e.target.value);
              if (t?.default_capacity) setCapacity(String(t.default_capacity));
            }}
            className={input}
          >
            <option value="">Sin tipo</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs">
            <span className="eyebrow">Cupo</span>
            <input
              type="number"
              min={1}
              max={60}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Duración (min)</span>
            <input
              type="number"
              min={10}
              max={180}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Hora real</span>
            <input
              type="time"
              step={60}
              value={realTime}
              onChange={(e) => setRealTime(e.target.value)}
              className={input}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Usa "Hora real" cuando solo este día empieza a otra hora que el renglón (por ejemplo, el
          viernes a las 8:15 en el renglón de 8:00). Aplica a todos los {weekdayName} del mes.
        </p>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <div className="flex flex-wrap gap-2">
            {cell ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (slotBlocked) {
                    onBlock(false);
                    return;
                  }
                  if (
                    window.confirm(
                      `¿Bloquear solo la clase del ${dayLabel} a las ${time}? Las demás semanas no cambian. Si alguien ya reservó, se cancela su reserva y se le regresa su crédito.`,
                    )
                  )
                    onBlock(true);
                }}
                className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted disabled:opacity-50"
              >
                {slotBlocked ? `Desbloquear el ${dayLabel}` : `Bloquear solo el ${dayLabel}`}
              </button>
            ) : null}
            {cell ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      `¿Quitar la clase de las ${time} de TODOS los ${weekdayName} del mes? Si solo quieres quitar la de esta semana, usa "Bloquear solo el ${dayLabel}".`,
                    )
                  )
                    onRemove();
                }}
                className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-destructive hover:bg-muted disabled:opacity-50"
              >
                Quitar de todo el mes
              </button>
            ) : null}
          </div>
          <button
            disabled={pending}
            className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </form>
    </Popout>
  );
}

type ClassTypeSave = {
  id?: string;
  name?: string;
  default_capacity: number | null;
  active?: boolean;
};

function ClassTypesEditor({
  moduleLabel,
  types,
  pending,
  onSave,
}: {
  moduleLabel: string;
  types: ClassTypeOption[];
  pending: boolean;
  onSave: (v: ClassTypeSave) => void;
}) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  return (
    <details className="mt-8 border border-border p-4" open>
      <summary className="cursor-pointer eyebrow">
        Tipos de clase de {moduleLabel}: nombres y cupos
      </summary>
      <p className="mt-3 text-xs text-muted-foreground">
        Corrige aquí cómo se escribe cada clase: el nombre nuevo se ve de inmediato en la página, la
        app, los horarios y el perfil de los coaches. El cupo se usa al asignar ese tipo a un bloque
        (déjalo vacío para usar el cupo normal del salón). "Ocultar" lo quita de la lista para
        asignar, sin borrar las clases que ya lo tienen.
      </p>
      <ul className="mt-3 divide-y divide-border border-y border-border text-sm">
        {types.map((t) => (
          <ClassTypeRow
            key={`${t.id}:${t.name}:${t.default_capacity}:${t.active}`}
            type={t}
            pending={pending}
            onSave={onSave}
          />
        ))}
        {types.length === 0 ? (
          <li className="py-3 text-muted-foreground">Sin tipos de clase todavía.</li>
        ) : null}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, default_capacity: toCapacity(capacity) });
          setName("");
          setCapacity("");
        }}
      >
        <label className="text-xs">
          <span className="eyebrow">Nuevo tipo</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Barre"
            maxLength={60}
            className={`${input} w-48`}
          />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Cupo</span>
          <input
            type="number"
            min={1}
            max={60}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={`${input} w-24`}
          />
        </label>
        <button
          disabled={pending || !name.trim()}
          className="border border-input px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] hover:bg-muted disabled:opacity-50"
        >
          + Agregar tipo
        </button>
      </form>
    </details>
  );
}

function toCapacity(v: string) {
  const n = Math.round(Number(v));
  return v.trim() && n > 0 ? n : null;
}

function ClassTypeRow({
  type,
  pending,
  onSave,
}: {
  type: ClassTypeOption;
  pending: boolean;
  onSave: (v: ClassTypeSave) => void;
}) {
  const [name, setName] = useState(type.name);
  const [capacity, setCapacity] = useState(
    type.default_capacity ? String(type.default_capacity) : "",
  );
  const nextCapacity = toCapacity(capacity);
  const dirty = name.trim() !== type.name || nextCapacity !== type.default_capacity;
  return (
    <li className="py-2.5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty) return;
          onSave({ id: type.id, name, default_capacity: nextCapacity });
        }}
      >
        <label className="min-w-[12rem] flex-1 text-xs">
          <span className="eyebrow">Nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            className={cn(input, !type.active && "text-muted-foreground line-through")}
          />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Cupo</span>
          <input
            type="number"
            min={1}
            max={60}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={`${input} w-20`}
          />
        </label>
        <button
          disabled={pending || !dirty || !name.trim()}
          className="bg-foreground px-4 py-2.5 text-[0.65rem] uppercase tracking-[0.14em] text-background disabled:opacity-40"
        >
          Guardar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onSave({ id: type.id, default_capacity: type.default_capacity, active: !type.active })
          }
          className="border border-input px-3 py-2.5 text-[0.65rem] uppercase tracking-[0.14em] hover:bg-muted disabled:opacity-40"
        >
          {type.active ? "Ocultar" : "Mostrar"}
        </button>
      </form>
    </li>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/describe-error";
import {
  REPEAT_LABELS,
  atTime,
  parseLocalDate,
  repeatDates,
  type RepeatMode,
} from "@/lib/class-repeat";

const MODULE_LABELS: Record<string, string> = {
  reformer: "Reformer",
  "4mat": "4mat",
  contraste: "Contrast Therapy",
  nutricion: "Nutrición",
  psicologia: "Psicología",
  rehabilitacion: "DorisFisio",
};

const DEFAULT_ROOM: Record<string, string> = {
  reformer: "Reformer",
  "4mat": "4mat",
  contraste: "Contrast",
  rehabilitacion: "Consultorio",
  nutricion: "Consultorio",
  psicologia: "Consultorio",
};

const control =
  "h-11 w-full border border-input bg-background px-3 text-sm outline-none focus:border-foreground";

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-xs", className)}>
      <span className="eyebrow truncate">{label}</span>
      {children}
    </label>
  );
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Coach = { id: string; full_name: string };
type ClassType = { id: string; name: string; module_key: string; default_capacity: number | null };

/**
 * Agregar clases a mano desde Horarios de clases: un día, la semana, o el
 * mismo día cada semana. Se marcan como cambio puntual para que "Actualizar
 * clases" no las borre ni las cambie.
 */
export function AddClassForm({
  modules,
  title,
  coaches,
  classTypes,
}: {
  modules: string[];
  title: string;
  coaches: Coach[];
  classTypes: ClassType[];
}) {
  const qc = useQueryClient();
  const [moduleKey, setModuleKey] = useState(modules[0] ?? "");
  const [typeId, setTypeId] = useState("");
  const [coach, setCoach] = useState("");
  const [otherName, setOtherName] = useState("");
  const [room, setRoom] = useState(DEFAULT_ROOM[modules[0] ?? ""] ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(String(modules[0] === "rehabilitacion" ? 40 : 50));
  const [capacity, setCapacity] = useState(String(modules[0] === "rehabilitacion" ? 1 : 10));
  const [repeat, setRepeat] = useState<RepeatMode>("once");
  const [until, setUntil] = useState("");

  const types = classTypes.filter((t) => t.module_key === moduleKey);
  const startDay = parseLocalDate(date);
  const untilDay = parseLocalDate(until);
  const isWeekend = startDay ? [0, 6].includes(startDay.getDay()) : false;

  const { data: rotationCoach } = useQuery({
    queryKey: ["weekend-coach", date],
    enabled: isWeekend && repeat === "once",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_weekend_coach", { _date: date });
      if (error) throw error;
      return (data?.[0] as { coach_id: string; coach_name: string } | undefined) ?? null;
    },
  });

  // Fechas y horas finales: se descartan las que ya pasaron.
  const planned = useMemo(() => {
    if (!startDay || !time) return [];
    if (repeat === "weekly_until" && !untilDay) return [];
    const nowMs = Date.now();
    return repeatDates(startDay, repeat, untilDay)
      .map((d) => atTime(d, time))
      .filter((d): d is Date => d !== null && d.getTime() > nowMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time, repeat, until]);

  const reset = () => {
    setDate("");
    setTime("");
    setRepeat("once");
    setUntil("");
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!startDay) throw new Error("Elige la fecha.");
      if (!time) throw new Error("Elige la hora.");
      if (repeat === "weekly_until" && !untilDay) throw new Error("Elige hasta qué fecha.");
      if (planned.length === 0) throw new Error("Esa fecha y hora ya pasaron.");
      const cap = Math.max(1, Math.round(Number(capacity) || 0));
      const dur = Math.max(10, Math.round(Number(duration) || 0));
      const tbd = coach === "__tbd";
      const coachRow = coaches.find((c) => c.id === coach);
      const instructor = tbd
        ? "Coach por anunciar"
        : coachRow
          ? coachRow.full_name
          : coach === "__other"
            ? otherName.trim()
            : "";
      if (coach === "__other" && !instructor) throw new Error("Escribe el nombre de quien la da.");

      // No duplicar: se omiten los horarios que ya tienen clase activa.
      const first = planned[0]!;
      const last = planned[planned.length - 1]!;
      const { data: existing, error: exError } = await supabase
        .from("classes")
        .select("starts_at")
        .eq("module_key", moduleKey)
        .eq("active", true)
        .gte("starts_at", first.toISOString())
        .lte("starts_at", last.toISOString());
      if (exError) throw exError;
      const taken = new Set((existing ?? []).map((c) => new Date(c.starts_at).getTime()));
      const rows = planned
        .filter((d) => !taken.has(d.getTime()))
        .map((d) => ({
          module_key: moduleKey,
          room: room.trim() || DEFAULT_ROOM[moduleKey] || "",
          instructor,
          coach_id: coachRow?.id ?? null,
          class_type_id: typeId || null,
          is_tbd: tbd,
          starts_at: d.toISOString(),
          capacity: cap,
          duration_min: dur,
          tokens_cost: 1,
          active: true,
          manual_override: true,
        }));
      if (rows.length === 0) {
        throw new Error("Ya hay una clase de este programa en ese horario.");
      }
      const { error } = await supabase.from("classes").insert(rows);
      if (error) throw error;
      return { created: rows.length, skipped: planned.length - rows.length };
    },
    onSuccess: ({ created, skipped }) => {
      toast.success(
        `${created === 1 ? "Clase agregada" : `${created} clases agregadas`}.${
          skipped > 0 ? ` Se omitieron ${skipped} que ya existían.` : ""
        } Ya se ven en la página y la app.`,
      );
      reset();
      for (const key of ["admin-schedule-classes", "classes", "app-day-classes"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e) => toast.error(describeError(e, "No se pudo agregar la clase.")),
  });

  const dayFmt = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <details className="group mb-6 border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-5 eyebrow">
        <Plus className="h-4 w-4 transition-transform group-open:rotate-45" />
        Agregar clase a {title.toLowerCase()}
      </summary>
      <form
        className="space-y-6 border-t border-border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.length > 1 ? (
            <Field label="Programa">
              <select
                value={moduleKey}
                onChange={(e) => {
                  setModuleKey(e.target.value);
                  setTypeId("");
                  setRoom(DEFAULT_ROOM[e.target.value] ?? "");
                }}
                className={control}
              >
                {modules.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Tipo de clase">
            <select
              value={typeId}
              onChange={(e) => {
                setTypeId(e.target.value);
                const t = types.find((x) => x.id === e.target.value);
                if (t?.default_capacity) setCapacity(String(t.default_capacity));
              }}
              className={control}
            >
              <option value="">Sin tipo</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Coach">
            <select value={coach} onChange={(e) => setCoach(e.target.value)} className={control}>
              <option value="">Sin asignar</option>
              <option value="__tbd">
                Por definir (en la página solo se ve la clase, sin coach)
              </option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
              <option value="__other">Otra persona…</option>
            </select>
          </Field>
          {coach === "__other" ? (
            <Field label="Nombre de quien la da">
              <input
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                className={control}
                placeholder="Ej. Invitada especial"
              />
            </Field>
          ) : null}
          <Field label="Salón / consultorio">
            <input value={room} onChange={(e) => setRoom(e.target.value)} className={control} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fecha">
            <input
              type="date"
              required
              value={date}
              min={ymd(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className={control}
            />
          </Field>
          <Field label="Hora de inicio">
            <input
              type="time"
              required
              step={300}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={control}
            />
          </Field>
          <Field label="Duración (min)">
            <input
              type="number"
              min={10}
              max={180}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className={control}
            />
          </Field>
          <Field label="Cupo">
            <input
              type="number"
              min={1}
              max={60}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className={control}
            />
          </Field>
        </div>

        {isWeekend && repeat === "once" && rotationCoach ? (
          <div className="flex flex-wrap items-center gap-3 border border-dashed border-border bg-muted/40 px-3 py-2 text-xs">
            <span>
              Coach en rotación ese {startDay?.getDay() === 6 ? "sábado" : "domingo"}:{" "}
              <strong>{rotationCoach.coach_name}</strong>
            </span>
            <button
              type="button"
              onClick={() => setCoach(rotationCoach.coach_id)}
              className="border border-foreground px-2 py-1 text-[0.65rem] uppercase tracking-wide hover:bg-foreground hover:text-background"
            >
              Asignar
            </button>
          </div>
        ) : null}

        <fieldset>
          <legend className="eyebrow mb-2">¿Para cuántas fechas?</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(REPEAT_LABELS) as RepeatMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRepeat(mode)}
                className={cn(
                  "min-h-11 border px-3 py-2 text-left text-xs",
                  repeat === mode
                    ? "border-foreground bg-foreground text-background"
                    : "border-input hover:bg-muted",
                )}
              >
                {REPEAT_LABELS[mode]}
              </button>
            ))}
          </div>
          {repeat === "weekly_until" ? (
            <div className="mt-3 max-w-xs">
              <Field label="Hasta (incluida)">
                <input
                  type="date"
                  value={until}
                  min={date || ymd(new Date())}
                  onChange={(e) => setUntil(e.target.value)}
                  className={control}
                />
              </Field>
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5">
          <button
            type="submit"
            disabled={create.isPending || planned.length === 0}
            className="h-11 bg-foreground px-6 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-40"
          >
            {create.isPending
              ? "Agregando…"
              : planned.length > 1
                ? `Agregar ${planned.length} clases`
                : "Agregar clase"}
          </button>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {!date || !time
              ? "Elige fecha y hora para ver qué días se crean."
              : planned.length === 0
                ? repeat === "weekly_until" && !until
                  ? "Elige hasta qué fecha."
                  : "Esa fecha y hora ya pasaron."
                : `Se crea${planned.length > 1 ? "n" : ""}: ${planned
                    .map((d) => dayFmt.format(d))
                    .join(", ")}.`}
          </p>
        </div>
      </form>
    </details>
  );
}

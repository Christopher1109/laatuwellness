import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MapPin, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { tryChargePendingNoShowFee } from "@/utils/membership-fee";

const input = "mt-1 w-full border border-input bg-background px-3 py-2 text-sm";

type ClassRow = Tables<"classes">;
type BookingRow = Tables<"bookings">;

type ViewMode = "day" | "week" | "month";

const MODULE_LABELS: Record<string, string> = {
  reformer: "Reformer",
  "4mat": "4mat",
  contraste: "Contraste",
  nutricion: "Nutrición",
  psicologia: "Psicología",
  rehabilitacion: "DorisFisio",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function rangeForView(date: Date, view: ViewMode) {
  if (view === "day") return { start: date, end: addDays(date, 1) };
  if (view === "week") {
    return {
      start: startOfWeek(date, { weekStartsOn: 1 }),
      end: addDays(endOfWeek(date, { weekStartsOn: 1 }), 1),
    };
  }
  return { start: startOfMonth(date), end: addDays(endOfMonth(date), 1) };
}

export function AdminSchedulePanel({ modules, title }: { modules: string[]; title: string }) {
  const qc = useQueryClient();
  const instructorRef = useRef<HTMLInputElement>(null);
  const [newClassDate, setNewClassDate] = useState("");

  const newClassDow = newClassDate ? new Date(newClassDate).getDay() : null;
  const isWeekendPick = newClassDow === 0 || newClassDow === 6;

  const weekendCoach = useQuery({
    queryKey: ["weekend-coach", newClassDate.slice(0, 10)],
    queryFn: async () => {
      const dateOnly = newClassDate.slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "get_weekend_coach" no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("get_weekend_coach", {
        _date: dateOnly,
      });
      if (error) throw error;
      return (data?.[0] as { coach_id: string; coach_name: string } | undefined) ?? null;
    },
    enabled: isWeekendPick,
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("day");
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [openClassId, setOpenClassId] = useState<string | null>(null);
  // Reloj interno: se fija al montar (evita desfase con el render del servidor)
  // y se actualiza cada 30 s para que el estado de cada clase se vea al entrar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);


  const { start, end } = useMemo(() => rangeForView(selectedDate, view), [selectedDate, view]);

  const { data: classes } = useQuery({
    queryKey: ["admin-schedule-classes", modules.join(","), start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .in("module_key", modules)
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data as ClassRow[];
    },
  });

  const classIds = useMemo(() => (classes ?? []).map((c) => c.id), [classes]);

  const { data: bookingCounts } = useQuery({
    enabled: classIds.length > 0,
    queryKey: ["admin-schedule-counts", classIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .in("class_id", classIds);
      if (error) throw error;
      const map = new Map<string, { reservada: number; lista_espera: number }>();
      for (const b of data ?? []) {
        const acc = map.get(b.class_id) ?? { reservada: 0, lista_espera: 0 };
        if (b.status === "reservada") acc.reservada += 1;
        if (b.status === "lista_espera") acc.lista_espera += 1;
        map.set(b.class_id, acc);
      }
      return map;
    },
  });

  const { data: coaches } = useQuery({
    queryKey: ["admin-schedule-coaches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coaches").select("name, image_url");
      if (error) throw error;
      return data;
    },
  });

  // Coaches "de verdad" (staff_profiles, role coach) para ligar coach_id a
  // la clase — distinto de la tabla "coaches" (bios/fotos públicas).
  const { data: staffCoaches } = useQuery({
    queryKey: ["admin-schedule-staff-coaches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name")
        .eq("role", "coach")
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const coachAvatar = (instructor: string) =>
    coaches?.find((c) => c.name.trim().toLowerCase() === instructor.trim().toLowerCase())
      ?.image_url ?? null;

  const create = useMutation({
    mutationFn: async (payload: {
      module_key: string;
      room: string;
      instructor: string;
      coach_id: string | null;
      starts_at: string;
      capacity: number;
      duration_min: number;
    }) => {
      const { error } = await supabase.from("classes").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agregado.");
      void qc.invalidateQueries({ queryKey: ["admin-schedule-classes"] });
    },
    onError: () => toast.error("No se pudo crear."),
  });

  const byDay = useMemo(() => {
    const groups = new Map<string, ClassRow[]>();
    for (const c of classes ?? []) {
      const key = format(new Date(c.starts_at), "yyyy-MM-dd");
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    // Las clases que ya terminaron se mandan al final del día y se atenúan,
    // para que la primera tarjeta sea siempre la que sigue o la que está en curso.
    for (const [k, items] of groups) {
      const done = (c: ClassRow) =>
        new Date(c.starts_at).getTime() + c.duration_min * 60000 <= now ? 1 : 0;
      groups.set(
        k,
        [...items].sort(
          (a, b) =>
            done(a) - done(b) ||
            new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        ),
      );
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [classes]);


  const monthGrid = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 1 });
    const days: Date[] = [];
    let cur = gridStart;
    while (cur <= gridEnd) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    return days;
  }, [monthCursor]);

  return (
    <div>
      <details className="mb-6 border border-border p-6">
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
              coach_id: String(f.get("coach_id") || "") || null,
              starts_at: new Date(local).toISOString(),
              capacity: Number(f.get("capacity") || 10),
              duration_min: Number(f.get("duration_min") || 50),
            });
            e.currentTarget.reset();
            setNewClassDate("");
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
            <span className="eyebrow">Coach (para nómina)</span>
            <select
              name="coach_id"
              className={input}
              onChange={(e) => {
                const name = e.target.selectedOptions[0]?.dataset["name"] ?? "";
                if (instructorRef.current && name) instructorRef.current.value = name;
              }}
            >
              <option value="">— sin asignar —</option>
              {(staffCoaches ?? []).map((c) => (
                <option key={c.id} value={c.id} data-name={c.full_name}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Instructora / especialista</span>
            <input name="instructor" ref={instructorRef} className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Fecha y hora</span>
            <input
              name="starts_at"
              type="datetime-local"
              required
              className={input}
              value={newClassDate}
              onChange={(e) => setNewClassDate(e.target.value)}
            />
          </label>
          {isWeekendPick ? (
            <div className="sm:col-span-3 lg:col-span-6 -mt-2 flex items-center gap-3 border border-dashed border-border bg-muted/40 px-3 py-2 text-xs">
              {weekendCoach.isLoading ? (
                <span className="text-muted-foreground">Buscando coach en rotación…</span>
              ) : weekendCoach.data ? (
                <>
                  <span>
                    Coach en rotación para este {newClassDow === 6 ? "sábado" : "domingo"}:{" "}
                    <strong>{weekendCoach.data.coach_name}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (instructorRef.current && weekendCoach.data) {
                        instructorRef.current.value = weekendCoach.data.coach_name;
                      }
                    }}
                    className="border border-foreground px-2 py-1 text-[0.65rem] uppercase tracking-wide hover:bg-foreground hover:text-background"
                  >
                    Usar este nombre
                  </button>
                </>
              ) : (
                <span className="text-muted-foreground">
                  No hay rotación configurada para este día.
                </span>
              )}
            </div>
          ) : null}
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

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* mini calendario + filtros */}
        <div className="space-y-4">
          <div className="border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonthCursor((m) => addMonths(m, -1))}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs capitalize">
                {format(monthCursor, "MMMM yyyy", { locale: es })}
              </span>
              <button
                type="button"
                onClick={() => setMonthCursor((m) => addMonths(m, 1))}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[0.6rem] text-muted-foreground">
              {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {monthGrid.map((d) => (
                <button
                  type="button"
                  key={d.toISOString()}
                  onClick={() => {
                    setSelectedDate(d);
                    setView("day");
                  }}
                  className={cn(
                    "py-1 text-[0.65rem]",
                    !isSameMonth(d, monthCursor) && "text-muted-foreground/40",
                    isSameDay(d, selectedDate) && "bg-foreground text-background",
                  )}
                >
                  {format(d, "d")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {(["day", "week", "month"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "border border-input px-3 py-2 text-[0.7rem] uppercase tracking-[0.12em]",
                  view === v && "bg-foreground text-background",
                )}
              >
                {v === "day" ? "Día" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setSelectedDate((d) =>
                  view === "day"
                    ? addDays(d, -1)
                    : view === "week"
                      ? addWeeks(d, -1)
                      : addMonths(d, -1),
                )
              }
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground">
              Hoy: {format(new Date(), "d MMM", { locale: es })}
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedDate((d) =>
                  view === "day"
                    ? addDays(d, 1)
                    : view === "week"
                      ? addWeeks(d, 1)
                      : addMonths(d, 1),
                )
              }
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* bloques de clase */}
        <div className="space-y-5">
          {byDay.length === 0 ? (
            <p className="text-muted-foreground">
              Sin horarios en este rango para {title.toLowerCase()}.
            </p>
          ) : null}
          {byDay.map(([dayKey, items]) => (
            <div key={dayKey}>
              <p className="mb-2 text-xs capitalize text-muted-foreground">
                {format(new Date(dayKey + "T00:00:00"), "EEEE d 'de' MMMM", { locale: es })}
              </p>
              <div className={cn("grid gap-3", view === "day" ? "sm:grid-cols-2" : "grid-cols-1")}>
                {items.map((c) => {
                  const counts = bookingCounts?.get(c.id) ?? { reservada: 0, lista_espera: 0 };
                  const full = counts.reservada >= c.capacity;
                  const pct = Math.min(
                    100,
                    Math.round((counts.reservada / Math.max(c.capacity, 1)) * 100),
                  );
                  const avatar = coachAvatar(c.instructor);
                  const endTime = new Date(
                    new Date(c.starts_at).getTime() + c.duration_min * 60000,
                  );
                  const finished = endTime.getTime() <= Date.now();
                  const inProgress = !finished && new Date(c.starts_at).getTime() <= Date.now();
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setOpenClassId(c.id)}
                      className={cn(
                        "flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3.5 text-left shadow-sm transition-colors hover:border-foreground/30 hover:shadow",
                        view !== "day" && "gap-1.5 p-2.5",
                        finished && "border-transparent bg-muted/60 opacity-60 shadow-none",
                        inProgress && "border-emerald-500/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
                            {format(new Date(c.starts_at), "HH:mm")} – {format(endTime, "HH:mm")} ·{" "}
                            {finished ? "Concluida" : inProgress ? "En curso" : "Clase"}
                          </p>
                          <p className="truncate text-sm font-semibold">
                            {MODULE_LABELS[c.module_key ?? ""] ?? c.module_key}
                          </p>
                        </div>

                        <Avatar className="h-8 w-8 shrink-0">
                          {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                          <AvatarFallback className="text-[0.6rem]">
                            {initials(c.instructor)}
                          </AvatarFallback>
                        </Avatar>
                      </div>

                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {c.instructor}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {c.room}
                        </span>
                      </p>

                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              full ? "bg-destructive" : "bg-emerald-500",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "shrink-0 text-[0.68rem] tabular-nums",
                            full ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {counts.reservada}/{c.capacity}
                        </span>
                      </div>
                      {counts.lista_espera > 0 ? (
                        <span className="w-fit whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.62rem] text-amber-700">
                          +{counts.lista_espera} en espera
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {openClassId ? (
        <ClassDetailDrawer
          classId={openClassId}
          onClose={() => {
            setOpenClassId(null);
            void qc.invalidateQueries({ queryKey: ["admin-schedule-counts"] });
          }}
          coachAvatar={coachAvatar}
        />
      ) : null}
    </div>
  );
}

function statusLabel(booking: BookingRow, checkin: { status: string } | undefined) {
  if (checkin?.status === "no_show") return { label: "No asistió", tone: "danger" as const };
  if (checkin) return { label: "Check-in", tone: "success" as const };
  return { label: "Reservado", tone: "muted" as const };
}

const actionBtn =
  "flex min-h-[3.25rem] items-center justify-center border border-input px-3 py-2 text-center text-[0.65rem] uppercase leading-tight tracking-[0.1em] transition-colors hover:bg-muted";
const actionBtnPrimary =
  "flex min-h-[3.25rem] items-center justify-center bg-foreground px-3 py-2 text-center text-[0.65rem] uppercase leading-tight tracking-[0.1em] text-background";

function ClassDetailDrawer({
  classId,
  onClose,
  coachAvatar,
}: {
  classId: string;
  onClose: () => void;
  coachAvatar: (instructor: string) => string | null;
}) {
  const qc = useQueryClient();

  const { data: cls } = useQuery({
    queryKey: ["admin-schedule-class", classId],
    queryFn: async () => {
      const { data, error } = await supabase.from("classes").select("*").eq("id", classId).single();
      if (error) throw error;
      return data as ClassRow;
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin-schedule-bookings", classId],
    queryFn: async () => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("class_id", classId)
        .order("created_at");
      if (error) throw error;
      const ids = (bookings ?? []).map((b) => b.user_id);
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
        : { data: [] as { id: string; full_name: string; email: string }[] };
      const { data: checks } = await supabase
        .from("check_ins")
        .select("*")
        .in(
          "booking_id",
          (bookings ?? []).map((b) => b.id),
        );
      return ((bookings as BookingRow[] | null) ?? []).map((b) => ({
        ...b,
        profile: profiles?.find((p) => p.id === b.user_id),
        checkin: checks?.find((c) => c.booking_id === b.id),
      }));
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-schedule-bookings", classId] });
    void qc.invalidateQueries({ queryKey: ["admin-schedule-counts"] });
  };

  const checkIn = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from("check_ins")
        .upsert({ booking_id: bookingId, status: "a_tiempo" }, { onConflict: "booking_id" });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const noShow = useMutation({
    mutationFn: async (bookingId: string) => {
      // El monto real ($150 MXN) lo decide el servidor y solo aplica si el
      // cliente tiene membresía activa — este valor es solo informativo.
      const { error } = await supabase.rpc("mark_no_show", {
        _booking_id: bookingId,
        _penalty_cents: 15000,
      });
      if (error) throw error;
      await tryChargePendingNoShowFee(bookingId);
    },
    onSuccess: invalidate,
  });

  const cancelBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error: refundError } = await supabase.rpc("refund_booking_credit", {
        p_booking_id: bookingId,
        p_reason: "Cancelación desde el panel admin",
      });
      if (refundError) throw refundError;
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelada", seat_number: null })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reservación cancelada, crédito devuelto.");
      invalidate();
    },
    onError: () => toast.error("No se pudo cancelar."),
  });

  const promoteFromWaitlist = useMutation({
    mutationFn: async ({ bookingId, seat }: { bookingId: string; seat: number | null }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "reservada", seat_number: seat })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pasó de lista de espera a reservación.");
      invalidate();
    },
    onError: () => toast.error("No se pudo mover (¿ya no hay lugares?)."),
  });

  const refundWaitlist = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error: refundError } = await supabase.rpc("refund_booking_credit", {
        p_booking_id: bookingId,
        p_reason: "No hubo espacio en lista de espera",
      });
      if (refundError) throw refundError;
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelada" })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Crédito devuelto, no hubo espacio.");
      invalidate();
    },
    onError: () => toast.error("No se pudo devolver el crédito."),
  });

  const assignSeat = useMutation({
    mutationFn: async ({ bookingId, seat }: { bookingId: string; seat: number | null }) => {
      const { data, error } = await supabase
        .from("bookings")
        .update({ seat_number: seat })
        .eq("id", bookingId)
        .select("id, seat_number");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("SIN_PERMISO");
      return data[0];
    },
    onSuccess: (row) => {
      toast.success(row?.seat_number ? `Lugar ${row.seat_number} asignado.` : "Lugar liberado.");
      invalidate();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message === "SIN_PERMISO"
          ? "No tienes permisos para asignar lugares."
          : "Ese lugar ya está ocupado.",
      ),
  });

  const [showSpotList, setShowSpotList] = useState(true);
  const [showBookMember, setShowBookMember] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");

  const { data: memberSuggestions } = useQuery({
    queryKey: ["class-book-member-search", memberQuery],
    enabled: memberQuery.trim().length > 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .or(`email.ilike.%${memberQuery.trim()}%,full_name.ilike.%${memberQuery.trim()}%`)
        .limit(6);
      return data ?? [];
    },
  });

  const bookMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_book_class", {
        _user_id: userId,
        _class_id: classId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Miembro registrado en la clase.");
      setShowBookMember(false);
      setMemberQuery("");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("CLASS_FULL")
          ? "La clase ya está llena."
          : e.message.includes("ALREADY_BOOKED")
            ? "Esa persona ya tiene esta clase reservada."
            : e.message.includes("INSUFFICIENT_TOKENS")
              ? "No tiene créditos suficientes."
              : "No se pudo registrar.",
      ),
  });

  const editClass = useMutation({
    mutationFn: async (patch: { room: string; instructor: string; capacity: number }) => {
      const { error } = await supabase.from("classes").update(patch).eq("id", classId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clase actualizada.");
      setShowEdit(false);
      invalidate();
    },
    onError: () => toast.error("No se pudo editar la clase."),
  });

  const deleteClass = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("classes").delete().eq("id", classId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clase borrada.");
      onClose();
    },
    onError: () => toast.error("No se pudo borrar (¿tiene reservaciones? Cancélalas primero)."),
  });

  const checkInEveryone = useMutation({
    mutationFn: async () => {
      const pending = reserved.filter((r) => !r.checkin);
      for (const r of pending) {
        await supabase
          .from("check_ins")
          .upsert({ booking_id: r.id, status: "a_tiempo" }, { onConflict: "booking_id" });
      }
    },
    onSuccess: () => {
      toast.success("Check-in hecho para todos.");
      invalidate();
    },
  });

  const downloadList = () => {
    const rowsCsv = [
      ["Nombre", "Correo", "Lugar", "Estatus"],
      ...reserved.map((r) => [
        r.profile?.full_name ?? "",
        r.profile?.email ?? "",
        String(r.seat_number ?? ""),
        statusLabel(r, r.checkin).label,
      ]),
    ];
    const csv = rowsCsv
      .map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lista-${classId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reserved = (rows ?? []).filter((r) => r.status === "reservada");
  const waitlist = (rows ?? []).filter((r) => r.status === "lista_espera");
  const cancelled = (rows ?? []).filter((r) => r.status === "cancelada");

  const capacity = cls?.capacity ?? 10;
  const seatCols = 5;
  const seatRows = Math.ceil(capacity / seatCols);
  const seats = Array.from({ length: seatRows * seatCols }, (_, i) => i + 1).filter(
    (n) => n <= capacity,
  );
  const takenBy = (seat: number) => reserved.find((r) => r.seat_number === seat);
  const [assigningFor, setAssigningFor] = useState<{ id: string; name: string } | null>(null);

  const avatar = cls ? coachAvatar(cls.instructor) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-[min(60rem,96vw)] overflow-y-auto bg-background p-6 lg:p-9"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11">
              {avatar ? <AvatarImage src={avatar} alt="" /> : null}
              <AvatarFallback>{cls ? initials(cls.instructor) : ""}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">
                {cls ? (MODULE_LABELS[cls.module_key ?? ""] ?? cls.module_key) : ""} ·{" "}
                {cls ? format(new Date(cls.starts_at), "HH:mm") : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {cls?.instructor} · {cls?.room} · {reserved.length}/{capacity} ocupado
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {waitlist.length > 0 ? (
              <span className="bg-amber-500/10 px-2.5 py-1 text-[0.65rem] text-amber-700">
                {waitlist.length} en espera
              </span>
            ) : null}
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mb-7 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="eyebrow mb-2">Acciones de la clase</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowBookMember((v) => !v)} className={actionBtnPrimary}>
                + Registrar miembro
              </button>
              <button onClick={() => setShowEdit((v) => !v)} className={actionBtn}>
                Editar clase
              </button>
              <button onClick={() => setShowSpotList((v) => !v)} className={actionBtn}>
                {showSpotList ? "Ocultar spot list" : "Mostrar spot list"}
              </button>
              <button
                onClick={() => {
                  if (confirm("¿Borrar esta clase? No se puede deshacer.")) deleteClass.mutate();
                }}
                className={cn(actionBtn, "border-destructive/40 text-destructive")}
              >
                Borrar
              </button>
            </div>
          </div>
          <div>
            <p className="eyebrow mb-2">Acciones de cliente</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => checkInEveryone.mutate()}
                disabled={checkInEveryone.isPending}
                className={cn(actionBtn, "disabled:opacity-50")}
              >
                Check-in a todos
              </button>
              <button
                onClick={() => toast("Carga de asistencia por Excel: próximamente.")}
                className={actionBtn}
              >
                Subir asistencia
              </button>
              <button
                onClick={() => toast("Mensajes grupales: próximamente.")}
                className={actionBtn}
              >
                Mensaje grupal
              </button>
              <button onClick={downloadList} className={actionBtn}>
                Descargar lista
              </button>
            </div>
          </div>
        </div>

        {showBookMember ? (
          <div className="relative mb-6 border border-border p-4">
            <p className="eyebrow mb-2">Registrar miembro</p>
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="Buscar por nombre o correo…"
              className="w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground"
            />
            {(memberSuggestions ?? []).length > 0 ? (
              <ul className="mt-2 divide-y divide-border border border-border">
                {(memberSuggestions ?? []).map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => bookMember.mutate(m.id)}
                      disabled={bookMember.isPending}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                    >
                      <span>
                        {m.full_name || "Sin nombre"}{" "}
                        <span className="text-muted-foreground">· {m.email}</span>
                      </span>
                      <span className="text-muted-foreground">Registrar</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {showEdit && cls ? (
          <form
            className="mb-6 grid gap-3 border border-border p-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              editClass.mutate({
                room: String(f.get("room") || cls.room),
                instructor: String(f.get("instructor") || cls.instructor),
                capacity: Number(f.get("capacity") || cls.capacity),
              });
            }}
          >
            <label className="text-xs">
              <span className="eyebrow">Salón</span>
              <input
                name="room"
                defaultValue={cls.room}
                className="mt-1 w-full border border-input bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Instructor</span>
              <input
                name="instructor"
                defaultValue={cls.instructor}
                className="mt-1 w-full border border-input bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Cupo</span>
              <input
                name="capacity"
                type="number"
                min={1}
                defaultValue={cls.capacity}
                className="mt-1 w-full border border-input bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <div className="sm:col-span-3">
              <button className="bg-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.1em] text-background">
                Guardar cambios
              </button>
            </div>
          </form>
        ) : null}

        {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

        <div className="mb-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="eyebrow mb-2">Reservaciones</p>
            <div className="space-y-1.5">
              {reserved.map((r) => {
                const { label, tone } = statusLabel(r, r.checkin);
                return (
                  <div key={r.id} className="border border-border p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        {r.seat_number ? (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[0.6rem] text-background">
                            {r.seat_number}
                          </span>
                        ) : null}
                        <span className="truncate">{r.profile?.full_name || r.profile?.email}</span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 px-1.5 py-0.5 text-[0.6rem]",
                          tone === "success" && "bg-green-500/10 text-green-700",
                          tone === "danger" && "bg-destructive/10 text-destructive",
                          tone === "muted" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                    </div>
                    {r.seat_number ? (
                      <p className="mt-1 text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground">
                        Lugar {r.seat_number}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        onClick={() =>
                          setAssigningFor(
                            assigningFor?.id === r.id
                              ? null
                              : {
                                  id: r.id,
                                  name: r.profile?.full_name || r.profile?.email || "",
                                },
                          )
                        }
                        className={cn(
                          "border px-2 py-1 text-[0.6rem] uppercase",
                          assigningFor?.id === r.id
                            ? "border-foreground bg-foreground text-background"
                            : "border-input",
                        )}
                      >
                        {assigningFor?.id === r.id
                          ? "Elige un lugar…"
                          : r.seat_number
                            ? "Cambiar lugar"
                            : "Asignar lugar"}
                      </button>
                      {r.seat_number ? (
                        <button
                          onClick={() => assignSeat.mutate({ bookingId: r.id, seat: null })}
                          className="border border-input px-2 py-1 text-[0.6rem] uppercase"
                        >
                          Quitar lugar
                        </button>
                      ) : null}
                      {!r.checkin ? (
                        <>
                          <button
                            onClick={() => checkIn.mutate(r.id)}
                            className="border border-input px-2 py-1 text-[0.6rem] uppercase"
                          >
                            Check-in
                          </button>
                          <button
                            onClick={() => noShow.mutate(r.id)}
                            className="border border-input px-2 py-1 text-[0.6rem] uppercase"
                          >
                            No asistió
                          </button>
                          <button
                            onClick={() => cancelBooking.mutate(r.id)}
                            className="border border-input px-2 py-1 text-[0.6rem] uppercase text-destructive"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {reserved.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin reservaciones.</p>
              ) : null}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-2">Lista de espera</p>
            <div className="space-y-1.5">
              {waitlist.map((r) => (
                <div key={r.id} className="border border-border p-2 text-xs">
                  <p className="truncate">{r.profile?.full_name || r.profile?.email}</p>
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      disabled={reserved.length >= capacity}
                      onClick={() => promoteFromWaitlist.mutate({ bookingId: r.id, seat: null })}
                      className="border border-input px-2 py-1 text-[0.6rem] uppercase disabled:opacity-40"
                    >
                      Pasar a clase
                    </button>
                    <button
                      onClick={() => refundWaitlist.mutate(r.id)}
                      className="border border-input px-2 py-1 text-[0.6rem] uppercase text-destructive"
                    >
                      Sin espacio · devolver
                    </button>
                  </div>
                </div>
              ))}
              {waitlist.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin lista de espera.</p>
              ) : null}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-2">Canceladas</p>
            <div className="space-y-1.5">
              {cancelled.map((r) => (
                <div key={r.id} className="border border-border p-2 text-xs text-muted-foreground">
                  {r.profile?.full_name || r.profile?.email}
                  <span className="ml-1 text-[0.6rem]">· crédito devuelto</span>
                </div>
              ))}
              {cancelled.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin cancelaciones.</p>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <p className="eyebrow mb-2">Mapa de lugares</p>
          {assigningFor ? (
            <p className="mb-2 text-xs text-foreground">
              Elige un lugar libre para <strong>{assigningFor.name}</strong>.{" "}
              <button onClick={() => setAssigningFor(null)} className="underline">
                cancelar
              </button>
            </p>
          ) : null}
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${seatCols}, minmax(0, 1fr))` }}
          >
            {seats.map((seat) => {
              const owner = takenBy(seat);
              const clickable = Boolean(assigningFor) && (!owner || owner.id === assigningFor?.id);
              return (
                <button
                  key={seat}
                  type="button"
                  disabled={!clickable && !owner}
                  onClick={() => {
                    if (!assigningFor) return;
                    if (owner && owner.id !== assigningFor.id) {
                      toast.error("Ese lugar ya está ocupado.");
                      return;
                    }
                    assignSeat.mutate({ bookingId: assigningFor.id, seat });
                    setAssigningFor(null);
                  }}
                  title={owner ? owner.profile?.full_name || owner.profile?.email || "" : "Libre"}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center gap-0.5 border p-1 text-center text-[0.6rem] leading-tight transition-colors",
                    owner
                      ? "border-transparent bg-foreground text-background"
                      : clickable
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/25"
                        : "border-emerald-500/40 bg-emerald-500/5 text-emerald-700/70",
                  )}
                >
                  <span className="text-[0.65rem] font-medium">{seat}</span>
                  {owner ? (
                    <>
                      <span className="line-clamp-2 w-full px-0.5">
                        {owner.profile?.full_name || owner.profile?.email || ""}
                      </span>
                      <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-background/80" />
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[0.65rem] text-muted-foreground">
            Verde = libre · oscuro con punto = ocupado (aparece el nombre). Dale clic a "Asignar
            lugar" junto a la persona en Reservaciones y luego elige un recuadro verde; el número
            queda guardado en su reservación.
          </p>
        </div>
      </div>
    </div>
  );
}

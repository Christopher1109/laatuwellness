import { useMemo, useState } from "react";
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
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const input = "mt-1 w-full border border-input bg-background px-3 py-2 text-sm";

type ClassRow = Tables<"classes">;
type BookingRow = Tables<"bookings">;

type ViewMode = "day" | "week" | "month";

const MODULE_LABELS: Record<string, string> = {
  reformer: "Reformer",
  "salon-2": "Salón 2",
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
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("day");
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [openClassId, setOpenClassId] = useState<string | null>(null);

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

  const coachAvatar = (instructor: string) =>
    coaches?.find((c) => c.name.trim().toLowerCase() === instructor.trim().toLowerCase())
      ?.image_url ?? null;

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
              <div className={cn("space-y-2", view !== "day" && "space-y-1.5")}>
                {items.map((c) => {
                  const counts = bookingCounts?.get(c.id) ?? { reservada: 0, lista_espera: 0 };
                  const full = counts.reservada >= c.capacity;
                  const avatar = coachAvatar(c.instructor);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setOpenClassId(c.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border border-border px-3 py-2.5 text-left hover:border-foreground/40",
                        view !== "day" && "py-2",
                      )}
                    >
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">
                        {format(new Date(c.starts_at), "HH:mm")}
                      </span>
                      <Avatar className="h-7 w-7 shrink-0">
                        {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                        <AvatarFallback className="text-[0.6rem]">
                          {initials(c.instructor)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {MODULE_LABELS[c.module_key ?? ""] ?? c.module_key}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.instructor} · {c.room}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 px-2 py-0.5 text-[0.65rem]",
                          full
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {counts.reservada}/{c.capacity}
                      </span>
                      {counts.lista_espera > 0 ? (
                        <span className="shrink-0 whitespace-nowrap bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-700">
                          +{counts.lista_espera} espera
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
      const { error } = await supabase.rpc("mark_no_show", {
        _booking_id: bookingId,
        _penalty_cents: 0,
      });
      if (error) throw error;
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
    mutationFn: async ({ bookingId, seat }: { bookingId: string; seat: number }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ seat_number: seat })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Ese lugar ya está ocupado."),
  });

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
        className="h-full w-full max-w-2xl overflow-y-auto bg-background p-6"
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

        {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

        <div className="mb-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="eyebrow mb-2">Reservaciones</p>
            <div className="space-y-1.5">
              {reserved.map((r) => {
                const { label, tone } = statusLabel(r, r.checkin);
                return (
                  <div key={r.id} className="border border-border p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 truncate">
                        {r.seat_number ? (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[0.6rem] text-background">
                            {r.seat_number}
                          </span>
                        ) : null}
                        {r.profile?.full_name || r.profile?.email}
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
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {!r.seat_number ? (
                        <button
                          onClick={() =>
                            setAssigningFor({
                              id: r.id,
                              name: r.profile?.full_name || r.profile?.email || "",
                            })
                          }
                          className={cn(
                            "border px-2 py-1 text-[0.6rem] uppercase",
                            assigningFor?.id === r.id
                              ? "border-foreground bg-foreground text-background"
                              : "border-input",
                          )}
                        >
                          {assigningFor?.id === r.id ? "Elige un lugar…" : "Asignar lugar"}
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
              const clickable = owner ? false : Boolean(assigningFor);
              return (
                <button
                  key={seat}
                  type="button"
                  disabled={!owner && !assigningFor}
                  onClick={() => {
                    if (owner || !assigningFor) return;
                    assignSeat.mutate({ bookingId: assigningFor.id, seat });
                    setAssigningFor(null);
                  }}
                  title={owner ? owner.profile?.full_name || owner.profile?.email || "" : "Libre"}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center gap-0.5 border p-1 text-center text-[0.6rem] leading-tight",
                    owner
                      ? "border-transparent bg-foreground text-background"
                      : clickable
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"
                        : "border-emerald-500/40 bg-emerald-500/5 text-emerald-700/70",
                  )}
                >
                  <span className="text-[0.65rem] font-medium">{seat}</span>
                  {owner ? (
                    <span className="line-clamp-1 w-full px-0.5">
                      {(owner.profile?.full_name || owner.profile?.email || "").split(" ")[0]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[0.65rem] text-muted-foreground">
            Cinco columnas · verde = libre · oscuro = ocupado (nombre en el recuadro). Para asignar
            un lugar, dale clic a "Asignar lugar" junto a la persona en Reservaciones.
          </p>
        </div>
      </div>
    </div>
  );
}

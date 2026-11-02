import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Search, UserX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tryChargePendingNoShowFee } from "@/utils/membership-fee";
import { describeError } from "@/lib/describe-error";
import { cn } from "@/lib/utils";

// ============================================================================
// CHECK-IN — clases del día en tarjetas (la clase en curso se elige sola) y
// la lista de quien reservó, con el estado de llegada de cada persona.
// ============================================================================

export type CheckInStatus = "a_tiempo" | "tarde" | "no_show";

export type CheckInClass = {
  id: string;
  starts_at: string;
  duration_min: number;
  capacity: number;
  room: string;
  instructor: string;
  is_tbd: boolean;
  typeName: string | null;
  booked: number;
};

export type CheckInRow = {
  id: string;
  name: string;
  detail: string;
  isGuest: boolean;
  seat: number | null;
  status: CheckInStatus | null;
};

const MODULE_LABELS: Record<string, string> = {
  reformer: "Reformer",
  "4mat": "4mat",
  contraste: "Contrast",
  rehabilitacion: "DorisFisio",
};

const timeFmt = new Intl.DateTimeFormat("es-MX", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Monterrey",
});

function classTitle(c: CheckInClass) {
  return c.typeName || c.room || "Clase";
}

function coachLabel(c: CheckInClass) {
  return c.is_tbd || !c.instructor ? "Coach por definir" : c.instructor;
}

type Phase = "en_curso" | "pronto" | "proxima" | "terminada";

function classPhase(c: CheckInClass, now: number): Phase {
  const start = new Date(c.starts_at).getTime();
  const end = start + c.duration_min * 60_000;
  if (now >= start && now <= end) return "en_curso";
  if (now < start) return start - now <= 20 * 60_000 ? "pronto" : "proxima";
  return "terminada";
}

// Clase que se abre sola: la que ya empezó más recientemente (hasta 15 min
// después de terminar); si ninguna, la siguiente del día.
function pickCurrentClass(classes: CheckInClass[], now = Date.now()) {
  if (classes.length === 0) return "";
  const inProgress = classes
    .filter((c) => {
      const start = new Date(c.starts_at).getTime();
      return now >= start && now <= start + (c.duration_min + 15) * 60_000;
    })
    .sort((x, y) => y.starts_at.localeCompare(x.starts_at))[0];
  if (inProgress) return inProgress.id;
  const upcoming = classes.find((c) => new Date(c.starts_at).getTime() > now);
  return upcoming?.id ?? classes[classes.length - 1]?.id ?? "";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

const STATUS_OPTIONS: {
  value: CheckInStatus;
  label: string;
  icon: typeof Check;
  active: string;
}[] = [
  {
    value: "a_tiempo",
    label: "A tiempo",
    icon: Check,
    active: "border-emerald-700 bg-emerald-700 text-white",
  },
  {
    value: "tarde",
    label: "Tarde",
    icon: Clock,
    active: "border-amber-600 bg-amber-600 text-white",
  },
  {
    value: "no_show",
    label: "No-show",
    icon: UserX,
    active: "border-destructive bg-destructive text-white",
  },
];

/** Vista sin datos de red: la usa el panel y se puede probar sola. */
export function CheckInView({
  classes,
  classId,
  onSelectClass,
  rows,
  onSetStatus,
  pendingBookingId,
  now = Date.now(),
}: {
  classes: CheckInClass[];
  classId: string;
  onSelectClass: (id: string) => void;
  rows: CheckInRow[] | undefined;
  /** status null = quitar la marca (se volvió a tocar el botón activo). */
  onSetStatus: (bookingId: string, status: CheckInStatus | null) => void;
  pendingBookingId?: string | null;
  now?: number;
}) {
  const [search, setSearch] = useState("");
  const current = classes.find((c) => c.id === classId);
  const stripRef = useRef<HTMLDivElement>(null);

  // La clase elegida siempre queda a la vista en la tira de clases.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [classId, classes.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (rows ?? []).filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q),
    );
    // Pendientes primero; dentro de cada grupo, por lugar y nombre.
    return list.sort((a, b) => {
      const pa = a.status ? 1 : 0;
      const pb = b.status ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if ((a.seat ?? 99) !== (b.seat ?? 99)) return (a.seat ?? 99) - (b.seat ?? 99);
      return a.name.localeCompare(b.name, "es");
    });
  }, [rows, search]);

  const total = rows?.length ?? 0;
  const arrived = (rows ?? []).filter(
    (r) => r.status === "a_tiempo" || r.status === "tarde",
  ).length;
  const noShows = (rows ?? []).filter((r) => r.status === "no_show").length;
  const pending = total - arrived - noShows;

  return (
    <div className="min-w-0">
      {/* Clases del día */}
      {classes.length === 0 ? (
        <p className="border border-border p-6 text-sm text-muted-foreground">
          No hay clases cerca de esta hora.
        </p>
      ) : (
        <div ref={stripRef} className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {classes.map((c) => {
            const phase = classPhase(c, now);
            const selected = c.id === classId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectClass(c.id)}
                aria-pressed={selected}
                className={cn(
                  "min-w-[11.5rem] shrink-0 snap-start border px-4 py-3 text-left transition-colors",
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:border-foreground/40",
                  !selected && phase === "terminada" && "opacity-55",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-lg leading-none">
                    {timeFmt.format(new Date(c.starts_at))}
                  </span>
                  {phase === "en_curso" || phase === "pronto" ? (
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.55rem] uppercase tracking-[0.14em]",
                        selected
                          ? "text-background/80"
                          : phase === "en_curso"
                            ? "text-emerald-700"
                            : "text-amber-700",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          phase === "en_curso" ? "bg-emerald-500" : "bg-amber-500",
                        )}
                      />
                      {phase === "en_curso" ? "En curso" : "Por empezar"}
                    </span>
                  ) : phase === "terminada" ? (
                    <span className="shrink-0 text-[0.55rem] uppercase tracking-[0.14em] opacity-70">
                      Terminó
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 truncate text-sm">{classTitle(c)}</p>
                <p
                  className={cn(
                    "truncate text-xs",
                    selected ? "text-background/70" : "text-muted-foreground",
                  )}
                >
                  {coachLabel(c)} · {c.booked}/{c.capacity}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {current ? (
        <>
          {/* Encabezado de la clase elegida */}
          <div className="mt-5 flex flex-col gap-4 border border-border bg-background p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">
                {timeFmt.format(new Date(current.starts_at))} · {current.duration_min} min
              </p>
              <p className="statement mt-1 truncate text-2xl">{classTitle(current)}</p>
              <p className="text-sm text-muted-foreground">{coachLabel(current)}</p>
            </div>
            <div className="grid grid-cols-3 gap-px border border-border bg-border text-center">
              <Counter label="Llegaron" value={arrived} />
              <Counter label="Pendientes" value={pending} />
              <Counter label="No-show" value={noShows} />
            </div>
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o correo…"
              aria-label="Buscar en la lista"
              className="w-full border border-input bg-background py-3 pl-9 pr-3 text-sm outline-none focus:border-foreground"
            />
          </div>

          <ul className="mt-4 space-y-2">
            {filtered.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "grid min-w-0 gap-3 border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4",
                  r.status ? "border-border/60" : "border-border",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs tracking-[0.06em]",
                      r.status === "a_tiempo"
                        ? "bg-emerald-700 text-white"
                        : r.status === "tarde"
                          ? "bg-amber-600 text-white"
                          : r.status === "no_show"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-foreground",
                    )}
                  >
                    {r.status === "a_tiempo" ? <Check className="h-4 w-4" /> : initials(r.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate">{r.name}</span>
                      {r.isGuest ? (
                        <span className="bg-muted px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.1em] text-muted-foreground">
                          Invitado
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.seat ? `Lugar ${r.seat}` : "Sin lugar"}
                      {r.detail ? ` · ${r.detail}` : ""}
                    </p>
                  </div>
                </div>

                <div
                  role="group"
                  aria-label={`Llegada de ${r.name}`}
                  className="grid grid-cols-3 gap-1.5"
                >
                  {STATUS_OPTIONS.map((o) => {
                    const on = r.status === o.value;
                    const Icon = o.icon;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        disabled={pendingBookingId === r.id}
                        aria-pressed={on}
                        title={on ? "Toca de nuevo para quitar la marca" : undefined}
                        onClick={() => onSetStatus(r.id, on ? null : o.value)}
                        className={cn(
                          "flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap border px-2 text-[0.62rem] uppercase tracking-[0.08em] transition-colors disabled:opacity-50 sm:px-3 sm:tracking-[0.12em]",
                          on
                            ? o.active
                            : "border-input bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground",
                        )}
                      >
                        <Icon className="hidden h-3.5 w-3.5 sm:block" />
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
            {rows && filtered.length === 0 ? (
              <li className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {total === 0 ? "Nadie ha reservado esta clase." : "Nadie coincide con la búsqueda."}
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[5.5rem] bg-background px-3 py-2">
      <p className="text-xl leading-none">{value}</p>
      <p className="mt-1 text-[0.55rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function CheckInPanel() {
  const qc = useQueryClient();
  const [classId, setClassId] = useState("");

  const { data: classes } = useQuery({
    queryKey: ["checkin-classes"],
    queryFn: async (): Promise<CheckInClass[]> => {
      const from = new Date();
      from.setHours(from.getHours() - 3);
      const to = new Date();
      to.setHours(to.getHours() + 12);
      const { data, error } = await supabase
        .from("classes")
        .select("*, class_types(name)")
        .eq("active", true)
        .gte("starts_at", from.toISOString())
        .lte("starts_at", to.toISOString())
        .order("starts_at")
        .limit(50);
      if (error) throw error;
      const ids = (data ?? []).map((c) => c.id);
      const { data: booked } = ids.length
        ? await supabase
            .from("bookings")
            .select("class_id")
            .in("class_id", ids)
            .eq("status", "reservada")
        : { data: [] as { class_id: string }[] };
      const counts = new Map<string, number>();
      for (const b of booked ?? []) counts.set(b.class_id, (counts.get(b.class_id) ?? 0) + 1);
      return (data ?? []).map((c) => {
        const type = (c as { class_types?: { name: string } | null }).class_types;
        return {
          id: c.id,
          starts_at: c.starts_at,
          duration_min: c.duration_min,
          capacity: c.capacity,
          room: c.room || MODULE_LABELS[c.module_key ?? ""] || "",
          instructor: c.instructor,
          is_tbd: c.is_tbd,
          typeName: type?.name ?? null,
          booked: counts.get(c.id) ?? 0,
        };
      });
    },
  });

  useEffect(() => {
    if (!classId && classes && classes.length) setClassId(pickCurrentClass(classes));
  }, [classes, classId]);

  const { data: rows } = useQuery({
    enabled: Boolean(classId),
    queryKey: ["checkin-bookings", classId],
    queryFn: async (): Promise<CheckInRow[]> => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("class_id", classId)
        .eq("status", "reservada");
      if (error) throw error;
      // Los invitados sin cuenta no tienen user_id.
      const ids = (bookings ?? []).map((b) => b.user_id).filter((id): id is string => Boolean(id));
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
        : { data: [] as { id: string; full_name: string; email: string }[] };
      const bookingIds = (bookings ?? []).map((b) => b.id);
      const { data: checks } = bookingIds.length
        ? await supabase.from("check_ins").select("booking_id, status").in("booking_id", bookingIds)
        : { data: [] as { booking_id: string; status: string }[] };
      return (bookings ?? []).map((b) => {
        const profile = profiles?.find((p) => p.id === b.user_id);
        const status = checks?.find((c) => c.booking_id === b.id)?.status ?? null;
        return {
          id: b.id,
          name: profile?.full_name || b.guest_name || "Sin nombre",
          detail: profile?.email ?? b.guest_phone ?? "",
          isGuest: !b.user_id && Boolean(b.guest_name),
          seat: b.seat_number,
          status: (status as CheckInStatus | null) ?? null,
        };
      });
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({
      bookingId,
      status,
    }: {
      bookingId: string;
      status: CheckInStatus | null;
    }) => {
      if (status === null) {
        // Se marcó por error: la persona vuelve a quedar pendiente.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
        const { error } = await (supabase.rpc as any)("clear_check_in", { _booking_id: bookingId });
        if (error) throw error;
      } else if (status === "no_show") {
        // El monto real ($150 MXN) lo decide el servidor y solo aplica si el
        // cliente tiene membresía activa — este valor es solo informativo.
        const { error } = await supabase.rpc("mark_no_show", {
          _booking_id: bookingId,
          _penalty_cents: 15000,
        });
        if (error) throw error;
        await tryChargePendingNoShowFee(bookingId);
      } else {
        const { error } = await supabase
          .from("check_ins")
          .upsert({ booking_id: bookingId, status }, { onConflict: "booking_id" });
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      if (vars.status === null) toast.success("Marca quitada.");
      void qc.invalidateQueries({ queryKey: ["checkin-bookings", classId] });
    },
    onError: (e) => toast.error(describeError(e, "No se pudo guardar la llegada.")),
  });

  return (
    <CheckInView
      classes={classes ?? []}
      classId={classId}
      onSelectClass={setClassId}
      rows={classId ? rows : []}
      onSetStatus={(bookingId, status) => setStatus.mutate({ bookingId, status })}
      pendingBookingId={setStatus.isPending ? (setStatus.variables?.bookingId ?? null) : null}
    />
  );
}

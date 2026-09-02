import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  CalendarDays,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  LogOut,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import { dayLabel, timeLabel } from "@/components/schedule";
import { Wordmark } from "@/components/brand";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { supabase } from "@/integrations/supabase/client";
import { PlanCheckoutModal, type CheckoutPlan } from "@/components/payments/plan-checkout-modal";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { tryChargePendingNoShowFee } from "@/utils/membership-fee";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "App — Läätu Wellness" },
      {
        name: "description",
        content:
          "Reserva tus clases, revisa tu lista de espera y tus créditos desde la app de Läätu.",
      },
    ],
  }),
  component: AppShell,
});

function money(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dateTime(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

type Tab = "horarios" | "reservas" | "creditos" | "tienda";

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: "horarios", label: "Horarios", icon: CalendarDays },
  { key: "reservas", label: "Reservas", icon: ListChecks },
  { key: "creditos", label: "Créditos", icon: Wallet },
  { key: "tienda", label: "Tienda", icon: ShoppingBag },
];

function AppShell() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("horarios");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  if (!user) return <AppLoginGate />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppTopBar />
      <main className="flex-1 pb-24">
        {tab === "horarios" ? <HorariosTab /> : null}
        {tab === "reservas" ? <ReservasTab /> : null}
        {tab === "creditos" ? <CreditosTab /> : null}
        {tab === "tienda" ? <TiendaTab /> : null}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-stretch">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-[0.62rem] uppercase tracking-[0.1em] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.6} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
      <WhatsAppButton />
    </div>
  );
}

function AppLoginGate() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-foreground px-6 text-center text-background">
      <Wordmark tone="ivory" className="h-10" />
      <p className="mt-8 max-w-xs text-sm text-background/70">
        Reserva tus clases, revisa tu lista de espera y tus créditos desde aquí.
      </p>
      <Link
        to="/auth"
        className="mt-8 w-full max-w-xs bg-background px-6 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-foreground"
      >
        Entrar o crear cuenta
      </Link>
      <Link to="/" className="mt-6 text-[0.68rem] uppercase tracking-[0.16em] text-background/60">
        Ver la página
      </Link>
    </div>
  );
}

function AppTopBar() {
  const { user } = useAuth();

  const { data: balance } = useQuery({
    queryKey: ["app-balance", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("token_balance", { _user_id: user!.id });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["app-profile", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const firstName = (profile?.full_name || "").split(" ")[0];

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-5 py-4 backdrop-blur-md">
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
          {firstName ? `Hola, ${firstName}` : "Läätu"}
        </p>
        <p className="text-lg leading-none">{balance ?? 0} créditos</p>
      </div>
      <button
        onClick={signOut}
        aria-label="Cerrar sesión"
        className="text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-5 w-5" />
      </button>
    </header>
  );
}

const ERRORS: Record<string, string> = {
  WAIVER_REQUIRED: "Necesitas firmar el waiver antes de reservar.",
  INSUFFICIENT_TOKENS: "No tienes créditos suficientes. Compra un paquete para continuar.",
  CLASS_FULL: "Esta clase ya está llena.",
  ALREADY_BOOKED: "Ya tienes esta clase reservada.",
  CLASS_PAST: "Esta clase ya pasó.",
  AUTH_REQUIRED: "Inicia sesión para reservar.",
  SEAT_TAKEN: "Ese lugar ya lo tomó alguien más, elige otro.",
};

type AppClassRow = {
  id: string;
  room: string;
  instructor: string;
  starts_at: string;
  duration_min: number;
  capacity: number;
  tokens_cost: number;
  module_key: string | null;
  taken: number;
  waitlisted: number;
};

function dayStripDays() {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function HorariosTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showCalendar, setShowCalendar] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [openClass, setOpenClass] = useState<AppClassRow | null>(null);

  const strip = useMemo(() => dayStripDays(), []);

  const dayBounds = useMemo(() => {
    const start = new Date(selectedDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, [selectedDate]);

  const { data: modules } = useQuery({
    queryKey: ["app-site-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_modules")
        .select("key, name")
        .eq("enabled", true);
      if (error) throw error;
      return data;
    },
  });
  const moduleName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of modules ?? []) map.set(m.key, m.name);
    return map;
  }, [modules]);

  const { data: classes, isLoading } = useQuery({
    queryKey: ["app-day-classes", dayBounds.start.toISOString()],
    queryFn: async (): Promise<AppClassRow[]> => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("active", true)
        .gte("starts_at", dayBounds.start.toISOString())
        .lt("starts_at", dayBounds.end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return Promise.all(
        (data ?? []).map(async (c) => {
          const { data: taken } = await supabase.rpc("class_seats_taken", { _class_id: c.id });
          const { data: waitlisted } = await supabase.rpc("class_waitlist_count", {
            _class_id: c.id,
          });
          return {
            ...c,
            taken: (taken as number | null) ?? 0,
            waitlisted: (waitlisted as number | null) ?? 0,
          };
        }),
      );
    },
  });

  const { data: myBookings } = useQuery({
    queryKey: ["app-my-booked-ids", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .in("status", ["reservada", "lista_espera"]);
      if (error) throw error;
      return data;
    },
  });
  const bookedIds = new Set(
    (myBookings ?? []).filter((b) => b.status === "reservada").map((b) => b.class_id),
  );
  const waitlistedIds = new Set(
    (myBookings ?? []).filter((b) => b.status === "lista_espera").map((b) => b.class_id),
  );

  const monthGrid = useMemo(() => {
    const start = new Date(monthCursor);
    const startDow = start.getDay();
    const gridStart = new Date(start);
    gridStart.setDate(gridStart.getDate() - startDow);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [monthCursor]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["app-day-classes"] });
    void qc.invalidateQueries({ queryKey: ["app-my-booked-ids"] });
    void qc.invalidateQueries({ queryKey: ["app-my-orders"] });
    void qc.invalidateQueries({ queryKey: ["app-balance"] });
    void qc.invalidateQueries({ queryKey: ["app-bookings"] });
    // Estas mismas tablas las lee el calendario admin y /horarios público —
    // al refrescar cualquiera de esas vistas ya reflejan la reserva nueva.
  };

  const book = useMutation({
    mutationFn: async ({ classId, seat }: { classId: string; seat: number | null }) => {
      const { error } = await supabase.rpc("book_class", { _class_id: classId, _seat: seat });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clase reservada. Nos vemos en el estudio.");
      setOpenClass(null);
      invalidateAll();
    },
    onError: (error: Error) => {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      toast.error(key ? ERRORS[key] : "No pudimos completar la reserva.");
      if (key === "WAIVER_REQUIRED" || key === "INSUFFICIENT_TOKENS") navigate({ to: "/cuenta" });
    },
  });

  const joinWaitlist = useMutation({
    mutationFn: async (classId: string) => {
      const { error } = await supabase.rpc("join_waitlist", { _class_id: classId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Estás en la lista de espera.");
      setOpenClass(null);
      invalidateAll();
    },
    onError: (error: Error) => {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      toast.error(key ? ERRORS[key] : "No pudimos anotarte.");
    },
  });

  return (
    <div>
      <div className="sticky top-[65px] z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1.5 overflow-x-auto">
            {strip.map((d) => {
              const isToday = sameDay(d, new Date());
              const active = sameDay(d, selectedDate);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => setSelectedDate(d)}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-0.5 rounded-full px-3 py-1.5",
                    active ? "bg-foreground text-background" : "text-muted-foreground",
                  )}
                >
                  <span className="text-[0.55rem] uppercase tracking-[0.08em]">
                    {isToday
                      ? "Hoy"
                      : new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(d)}
                  </span>
                  <span className="text-sm font-medium">{d.getDate()}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setShowCalendar(true)}
            aria-label="Elegir fecha"
            className="shrink-0 border border-input p-2 text-muted-foreground hover:text-foreground"
          >
            <CalendarSearch className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2.5 px-5 py-5">
        {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
        {(classes ?? []).map((c) => {
          const full = c.taken >= c.capacity;
          const mine = bookedIds.has(c.id);
          const waiting = waitlistedIds.has(c.id);
          const libres = Math.max(c.capacity - c.taken, 0);
          return (
            <button
              key={c.id}
              onClick={() => setOpenClass(c)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-3.5 text-left hover:border-foreground/30"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                {c.instructor
                  .split(" ")
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase())
                  .join("")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {moduleName.get(c.module_key ?? "") ?? c.module_key}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.instructor} · {c.room} · {c.duration_min} min
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-full bg-foreground px-2.5 py-1 text-[0.68rem] text-background">
                  {timeLabel(c.starts_at)}
                </span>
                {mine ? (
                  <span className="text-[0.6rem] uppercase tracking-[0.08em] text-emerald-600">
                    Reservada
                  </span>
                ) : waiting ? (
                  <span className="text-[0.6rem] uppercase tracking-[0.08em] text-amber-600">
                    En espera
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[0.6rem] uppercase tracking-[0.08em]",
                      full ? "text-amber-600" : "text-muted-foreground",
                    )}
                  >
                    {full ? "Lista de espera" : `${libres} lugares`}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {!isLoading && (classes ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin clases este día.</p>
        ) : null}
      </div>

      {showCalendar ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setShowCalendar(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-background p-6 sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-lg">Elige una fecha</p>
              <button onClick={() => setShowCalendar(false)} aria-label="Cerrar">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="mb-3 flex items-center justify-between">
              <button
                onClick={() =>
                  setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
                }
                className="p-1 text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-sm capitalize">
                {new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(
                  monthCursor,
                )}
              </p>
              <button
                onClick={() =>
                  setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
                }
                className="p-1 text-muted-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[0.6rem] text-muted-foreground">
              {["D", "L", "M", "M", "J", "V", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid.map((d) => {
                const inMonth = d.getMonth() === monthCursor.getMonth();
                const active = sameDay(d, selectedDate);
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => setSelectedDate(d)}
                    className={cn(
                      "py-2 text-sm",
                      !inMonth && "text-muted-foreground/30",
                      active && "bg-foreground text-background",
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowCalendar(false)}
              className="mt-5 w-full bg-foreground px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] text-background"
            >
              Ver resultados
            </button>
          </div>
        </div>
      ) : null}

      {openClass ? (
        <AppClassDetail
          classItem={openClass}
          moduleLabel={moduleName.get(openClass.module_key ?? "") ?? openClass.module_key ?? ""}
          mine={bookedIds.has(openClass.id)}
          waiting={waitlistedIds.has(openClass.id)}
          onClose={() => setOpenClass(null)}
          onReserve={(seat) => book.mutate({ classId: openClass.id, seat })}
          onJoinWaitlist={() => joinWaitlist.mutate(openClass.id)}
          pending={book.isPending || joinWaitlist.isPending}
        />
      ) : null}
    </div>
  );
}

function AppClassDetail({
  classItem,
  moduleLabel,
  mine,
  waiting,
  onClose,
  onReserve,
  onJoinWaitlist,
  pending,
}: {
  classItem: AppClassRow;
  moduleLabel: string;
  mine: boolean;
  waiting: boolean;
  onClose: () => void;
  onReserve: (seat: number | null) => void;
  onJoinWaitlist: () => void;
  pending: boolean;
}) {
  const [seat, setSeat] = useState<number | null>(null);
  const full = classItem.taken >= classItem.capacity;

  const { data: takenSeats } = useQuery({
    queryKey: ["app-class-taken-seats", classItem.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("class_taken_seats", { _class_id: classItem.id });
      if (error) throw error;
      return (data as number[] | null) ?? [];
    },
  });

  const cols = 5;
  const rows = Math.ceil(classItem.capacity / cols);
  const seats = Array.from({ length: rows * cols }, (_, i) => i + 1).filter(
    (n) => n <= classItem.capacity,
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="mx-auto max-w-md px-5 py-6">
        <button
          onClick={onClose}
          className="mb-5 text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          ← Cerrar
        </button>

        <p className="text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">
          {dayLabel(classItem.starts_at)} · {timeLabel(classItem.starts_at)}
        </p>
        <h2 className="mt-1 text-2xl">{moduleLabel}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {classItem.instructor} · {classItem.room} · {classItem.duration_min} min
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span
            className={cn(
              "px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.1em]",
              full ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700",
            )}
          >
            {full ? "Sin lugares" : `${classItem.capacity - classItem.taken} lugares libres`}
          </span>
          {classItem.waitlisted > 0 ? (
            <span className="bg-muted px-2.5 py-1 text-[0.65rem] text-muted-foreground">
              {classItem.waitlisted} en espera
            </span>
          ) : null}
        </div>

        {mine ? (
          <p className="mt-8 text-sm text-emerald-600">Ya tienes esta clase reservada.</p>
        ) : waiting ? (
          <p className="mt-8 text-sm text-amber-600">
            Ya estás en la lista de espera de esta clase.
          </p>
        ) : (
          <>
            {!full ? (
              <div className="mt-8">
                <p className="mb-3 eyebrow">Elige tu lugar</p>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {seats.map((n) => {
                    const taken = (takenSeats ?? []).includes(n);
                    const selected = seat === n;
                    return (
                      <button
                        key={n}
                        disabled={taken}
                        onClick={() => setSeat(n)}
                        className={cn(
                          "flex aspect-square items-center justify-center border text-sm",
                          taken
                            ? "border-transparent bg-foreground text-background opacity-60"
                            : selected
                              ? "border-secondary bg-secondary text-background"
                              : "border-emerald-500 bg-emerald-500/10 text-emerald-700",
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <button
                  disabled={!seat || pending}
                  onClick={() => onReserve(seat)}
                  className="mt-6 w-full bg-foreground px-5 py-3.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-40"
                >
                  Reservar lugar {seat ? `#${seat}` : ""}
                </button>
              </div>
            ) : (
              <button
                disabled={pending}
                onClick={onJoinWaitlist}
                className="mt-8 w-full border border-foreground px-5 py-3.5 text-[0.7rem] uppercase tracking-[0.16em] disabled:opacity-40"
              >
                Unirme a la lista de espera
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReservasTab() {
  const { user } = useAuth();

  const { data: bookings } = useQuery({
    queryKey: ["app-bookings", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, classes(room, instructor, starts_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("cancel_booking", { _booking_id: bookingId });
      if (error) throw error;
      await tryChargePendingNoShowFee(bookingId);
    },
    onSuccess: () => {
      toast.success("Reserva cancelada.");
      void qc.invalidateQueries({ queryKey: ["app-bookings"] });
    },
    onError: () => toast.error("No pudimos cancelar."),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("leave_waitlist", { _booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saliste de la lista de espera.");
      void qc.invalidateQueries({ queryKey: ["app-bookings"] });
    },
    onError: () => toast.error("No se pudo salir de la lista de espera."),
  });

  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) => b.status === "reservada" && new Date(b.classes!.starts_at).getTime() > now,
  );
  const waitlisted = (bookings ?? []).filter(
    (b) => b.status === "lista_espera" && new Date(b.classes!.starts_at).getTime() > now,
  );
  const past = (bookings ?? []).filter(
    (b) =>
      (b.status !== "reservada" && b.status !== "lista_espera") ||
      new Date(b.classes!.starts_at).getTime() <= now,
  );

  return (
    <div className="space-y-10 px-5 py-6">
      <div>
        <p className="eyebrow">Próximas</p>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aún no tienes reservas.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm">
                    {dateTime(b.classes!.starts_at)}
                    {b.seat_number ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[0.55rem] text-background">
                        {b.seat_number}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.classes!.room} · {b.classes!.instructor}
                  </p>
                </div>
                <button
                  onClick={() => cancel.mutate(b.id)}
                  className="shrink-0 border border-input px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.14em]"
                >
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {waitlisted.length > 0 ? (
        <div>
          <p className="eyebrow">Lista de espera</p>
          <ul className="mt-3 divide-y divide-border">
            {waitlisted.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm">{dateTime(b.classes!.starts_at)}</p>
                  <p className="truncate text-xs text-amber-600">Crédito apartado</p>
                </div>
                <button
                  onClick={() => leaveWaitlist.mutate(b.id)}
                  className="shrink-0 border border-input px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.14em]"
                >
                  Salir
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="eyebrow">Historial</p>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aún sin historial.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {past.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="text-muted-foreground">{dateTime(b.classes!.starts_at)}</span>
                <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Class Packages",
  membresia: "Membresías",
  consulta: "Align — DorisFisio",
  recuperacion: "Contrast",
};
const CATEGORY_ORDER = ["clases_pilates", "membresia", "consulta", "recuperacion"];

function CreditosTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [buying, setBuying] = useState<CheckoutPlan | null>(null);

  const { data: balance } = useQuery({
    queryKey: ["app-balance", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("token_balance", { _user_id: user!.id });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["app-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_plans")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ["app-transactions", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, token_plans(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof plans>>();
    for (const p of plans ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!] as const);
  }, [plans]);

  const activeMembership = useMemo(() => {
    const tx = (transactions ?? []).find((t) => {
      const cat = (plans ?? []).find((p) => p.id === t.plan_id)?.category;
      return cat === "membresia";
    });
    return tx;
  }, [transactions, plans]);

  const [view, setView] = useState<"creditos" | "membresia">("creditos");
  const creditPlans = grouped.filter(([c]) => c !== "membresia");
  const membershipPlans = grouped.find(([c]) => c === "membresia")?.[1] ?? [];

  return (
    <div className="px-5 py-6">
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setView("membresia")}
          className={cn(
            "flex flex-col items-center gap-2 border p-4 text-center",
            view === "membresia" ? "border-foreground" : "border-border",
          )}
        >
          <BadgeCheck className="h-6 w-6" />
          <span className="text-[0.65rem] uppercase tracking-[0.1em]">Membresía</span>
        </button>
        <button
          onClick={() => setView("creditos")}
          className={cn(
            "flex flex-col items-center gap-2 border p-4 text-center",
            view === "creditos" ? "border-foreground" : "border-border",
          )}
        >
          <Wallet className="h-6 w-6" />
          <span className="text-[0.65rem] uppercase tracking-[0.1em]">Créditos</span>
        </button>
      </div>

      <div className="mt-8 border border-border p-6 text-center">
        <p className="eyebrow">Créditos disponibles</p>
        <p className="mt-2 text-4xl">{balance ?? 0}</p>
      </div>

      {view === "membresia" ? (
        <div className="mt-8">
          {activeMembership ? (
            <div className="border border-foreground p-5">
              <p className="eyebrow">Membresía activa</p>
              <p className="mt-1 text-lg">{activeMembership.token_plans?.name ?? "Membresía"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Desde el{" "}
                {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                  new Date(activeMembership.created_at),
                )}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <BadgeCheck className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Sin membresía activa</p>
              <p className="max-w-[220px] text-xs text-muted-foreground">
                Las membresías incluyen clases, Align y Contrast en un solo pago mensual.
              </p>
            </div>
          )}
          <div className="mt-6 space-y-2">
            {membershipPlans.map((p) => (
              <div key={p.id} className="border border-border p-4">
                <p className="text-sm">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.subtitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {money(p.price_cents, p.currency)}/mes
                </p>
                <button
                  onClick={() => setBuying(p as unknown as CheckoutPlan)}
                  className="mt-3 w-full bg-foreground px-4 py-2 text-[0.62rem] uppercase tracking-[0.14em] text-background"
                >
                  Elegir membresía
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {creditPlans.map(([category, items]) => (
            <div key={category}>
              <p className="eyebrow">{CATEGORY_LABELS[category] ?? category}</p>
              <div className="mt-3 space-y-2">
                {items.map((p) => (
                  <div key={p.id} className="border border-border p-4">
                    <p className="text-sm">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {money(p.price_cents, p.currency)} · {p.tokens} créditos
                    </p>
                    <button
                      onClick={() => setBuying(p as unknown as CheckoutPlan)}
                      className="mt-3 w-full border border-foreground px-4 py-2 text-[0.62rem] uppercase tracking-[0.14em]"
                    >
                      Comprar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        <p className="eyebrow">Compras recientes</p>
        {(transactions ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Sin compras registradas.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {(transactions ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>{t.token_plans?.name ?? "Paquete"}</span>
                <span className="text-xs text-muted-foreground">
                  {money(t.amount_cents, t.currency)} · +{t.tokens}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {buying ? (
        <PlanCheckoutModal plan={buying} user={user} onClose={() => setBuying(null)} />
      ) : null}
    </div>
  );
}

const STORE_CATEGORY_LABELS: Record<string, string> = {
  merch: "Merch",
  consumible: "Fuel",
};

function TiendaTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["app-store-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: myOrders } = useQuery({
    queryKey: ["app-my-orders", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data: sales, error } = await supabase
        .from("pos_sales")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const saleIds = (sales ?? []).map((s) => s.id);
      const { data: items } = saleIds.length
        ? await supabase.from("pos_sale_items").select("*").in("sale_id", saleIds)
        : { data: [] as { sale_id: string; description: string; qty: number }[] };
      return (sales ?? []).map((s) => ({
        ...s,
        items: (items ?? []).filter((i) => i.sale_id === s.id),
      }));
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof products>>();
    for (const p of products ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return Array.from(groups.entries());
  }, [products]);

  const total = useMemo(() => {
    if (!products) return 0;
    return Object.entries(cart).reduce((sum, [id, qty]) => {
      const p = products.find((p) => p.id === id);
      return sum + (p ? p.price_cents * qty : 0);
    }, 0);
  }, [cart, products]);

  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const placeOrder = useMutation({
    mutationFn: async () => {
      const items = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({ product_id: id, qty }));
      if (items.length === 0) throw new Error("Agrega al menos un producto.");
      const { error } = await supabase.rpc("client_place_order", { _items: items });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido enviado — págalo al recogerlo en el estudio.");
      setCart({});
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["app-my-orders"] });
    },
    onError: () => toast.error("No se pudo enviar el pedido."),
  });

  const statusLabel: Record<string, string> = {
    pendiente: "Pendiente",
    listo: "Listo para recoger",
    entregado: "Entregado",
  };

  return (
    <div className="space-y-10 px-5 py-6">
      <p className="text-center text-lg">Featured items</p>
      {grouped.map(([category, items]) => (
        <div key={category}>
          <p className="eyebrow">{STORE_CATEGORY_LABELS[category] ?? category}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {items.map((p) => (
              <div key={p.id} className="border border-border">
                <div className="flex aspect-square items-center justify-center bg-muted">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{money(p.price_cents)}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      onClick={() =>
                        setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))
                      }
                      className="border border-input px-2.5 py-1 text-sm"
                    >
                      −
                    </button>
                    <span className="text-sm">{cart[p.id] ?? 0}</span>
                    <button
                      onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}
                      className="border border-input px-2.5 py-1 text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin productos publicados.</p>
      ) : null}

      {itemCount > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background p-4">
          <button
            onClick={() => setConfirming(true)}
            className="flex w-full items-center justify-between bg-foreground px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] text-background"
          >
            <span>
              {itemCount} producto{itemCount === 1 ? "" : "s"}
            </span>
            <span>{money(total)}</span>
          </button>
        </div>
      ) : null}

      <div>
        <p className="eyebrow">Mis pedidos recientes</p>
        <ul className="mt-3 divide-y divide-border">
          {(myOrders ?? []).map((o) => (
            <li key={o.id} className="py-3">
              <div className="flex items-center justify-between text-sm">
                <span>{o.items.map((i) => `${i.qty}× ${i.description}`).join(", ")}</span>
                <span className="text-xs text-muted-foreground">{money(o.total_cents)}</span>
              </div>
              <span
                className={cn(
                  "mt-1 inline-block px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em]",
                  o.status === "entregado"
                    ? "bg-muted text-muted-foreground"
                    : o.status === "listo"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-amber-500/10 text-amber-700",
                )}
              >
                {statusLabel[o.status] ?? o.status}
              </span>
            </li>
          ))}
          {(myOrders ?? []).length === 0 ? (
            <li className="py-3 text-sm text-muted-foreground">Sin pedidos todavía.</li>
          ) : null}
        </ul>
      </div>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirming(false)}
        >
          <div className="w-full max-w-sm bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Confirmar pedido</p>
            <ul className="mt-3 space-y-1 text-sm">
              {Object.entries(cart)
                .filter(([, qty]) => qty > 0)
                .map(([id, qty]) => {
                  const p = products?.find((p) => p.id === id);
                  return (
                    <li key={id} className="flex justify-between">
                      <span>
                        {qty}× {p?.name}
                      </span>
                      <span>{money((p?.price_cents ?? 0) * qty)}</span>
                    </li>
                  );
                })}
            </ul>
            <div className="mt-3 flex justify-between border-t border-border pt-3 text-lg">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Se paga al recogerlo en el estudio (tarjeta o efectivo). Los pagos en línea llegan
              pronto con Stripe.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 border border-input px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em]"
              >
                Cancelar
              </button>
              <button
                disabled={placeOrder.isPending}
                onClick={() => placeOrder.mutate()}
                className="flex-1 bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
              >
                {placeOrder.isPending ? "Enviando…" : "Enviar pedido"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

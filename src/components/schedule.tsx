import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BirdBadge } from "@/components/brand";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  WAIVER_REQUIRED: "Necesitas firmar el waiver antes de reservar.",
  INSUFFICIENT_TOKENS:
    "No tienes tokens suficientes. Compra un paquete para continuar.",
  CLASS_FULL: "Esta clase ya está llena.",
  ALREADY_BOOKED: "Ya tienes esta clase reservada.",
  CLASS_PAST: "Esta clase ya pasó.",
  AUTH_REQUIRED: "Inicia sesión para reservar.",
};

export type Rango = "hoy" | "semana" | "siguiente";

export const RANGOS: { key: Rango; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Esta semana" },
  { key: "siguiente", label: "Próxima semana" },
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Lunes de la semana de `d`. */
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function rangeBounds(rango: Rango) {
  const now = new Date();
  if (rango === "hoy") {
    const end = startOfDay(now);
    end.setDate(end.getDate() + 1);
    return { from: now, to: end };
  }
  const weekStart = startOfWeek(now);
  if (rango === "semana") {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return { from: now, to: end };
  }
  const from = new Date(weekStart);
  from.setDate(from.getDate() + 7);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

export function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function RangeTabs({
  value,
  onChange,
  className,
}: {
  value: Rango;
  onChange: (r: Rango) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:px-0",
        className,
      )}
    >
      {RANGOS.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={cn(
            "shrink-0 border px-4 py-2.5 text-[0.64rem] uppercase tracking-[0.16em] transition-colors sm:px-5 sm:text-[0.68rem] sm:tracking-[0.18em]",
            value === r.key
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}


type ClassRow = {
  id: string;
  room: string;
  instructor: string;
  starts_at: string;
  duration_min: number;
  capacity: number;
  tokens_cost: number;
  module_key: string | null;
  taken: number;
};

/**
 * Agenda de clases con reserva. Se segmenta por programa y cada programa
 * vive en su propia ventana con scroll para que la lista nunca crezca de más.
 */
export function Schedule({
  moduleKey,
  defaultRange = "hoy",
  showTabs = true,
  showModuleFilter,
  limit,
}: {
  moduleKey?: string | undefined;
  defaultRange?: Rango;
  showTabs?: boolean;
  showModuleFilter?: boolean;
  limit?: number;
}) {
  const [rango, setRango] = useState<Rango>(defaultRange);
  const [filtro, setFiltro] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { from, to } = rangeBounds(rango);
  const conFiltro = showModuleFilter ?? !moduleKey;

  const { data: modules } = useQuery({
    queryKey: ["site-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_modules")
        .select("*")
        .eq("enabled", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const nombre = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of modules ?? []) map.set(m.key, m.name);
    return map;
  }, [modules]);

  const { data: classes, isLoading } = useQuery({
    queryKey: ["classes", moduleKey ?? "all", rango],
    queryFn: async (): Promise<ClassRow[]> => {
      let q = supabase
        .from("classes")
        .select("*")
        .eq("active", true)
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at");
      if (moduleKey) q = q.eq("module_key", moduleKey);
      const { data, error } = await q.limit(120);
      if (error) throw error;

      return Promise.all(
        data.map(async (c) => {
          const { data: taken } = await supabase.rpc("class_seats_taken", {
            _class_id: c.id,
          });
          return { ...c, taken: (taken as number | null) ?? 0 };
        }),
      );
    },
  });

  const { data: myBookings } = useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .eq("status", "reservada");
      if (error) throw error;
      return data;
    },
  });

  const bookedIds = useMemo(
    () => new Set((myBookings ?? []).map((b) => b.class_id)),
    [myBookings],
  );

  const book = useMutation({
    mutationFn: async (classId: string) => {
      const { error } = await supabase.rpc("book_class", { _class_id: classId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clase reservada. Nos vemos en el estudio.");
      void qc.invalidateQueries({ queryKey: ["classes"] });
      void qc.invalidateQueries({ queryKey: ["my-bookings"] });
      void qc.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error: Error) => {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      toast.error(key ? ERRORS[key] : "No pudimos completar la reserva.");
      if (key === "WAIVER_REQUIRED" || key === "INSUFFICIENT_TOKENS") {
        navigate({ to: "/cuenta" });
      }
    },
  });

  const all = classes ?? [];

  /** Programas presentes en el rango, en el orden del catálogo. */
  const presentes = useMemo(() => {
    const keys = new Set(all.map((c) => c.module_key ?? "otros"));
    const ordered = (modules ?? [])
      .map((m) => m.key)
      .filter((k) => keys.has(k));
    for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [all, modules]);

  const grupos = useMemo(() => {
    const activos = filtro ? presentes.filter((k) => k === filtro) : presentes;
    return activos.map((key) => {
      let items = all.filter((c) => (c.module_key ?? "otros") === key);
      if (limit) items = items.slice(0, limit);
      const dias = new Map<string, ClassRow[]>();
      for (const c of items) {
        const d = dayLabel(c.starts_at);
        dias.set(d, [...(dias.get(d) ?? []), c]);
      }
      return { key, total: items.length, dias: [...dias.entries()] };
    });
  }, [all, presentes, filtro, limit]);

  const total = grupos.reduce((n, g) => n + g.total, 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
        {showTabs ? <RangeTabs value={rango} onChange={setRango} /> : null}
        {showTabs && conFiltro ? (
          <span className="hidden h-6 w-px bg-border sm:block" />
        ) : null}
        {conFiltro ? (
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:px-0">
            <button
              onClick={() => setFiltro(null)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-[0.64rem] uppercase tracking-[0.16em] transition-colors",
                filtro === null
                  ? "border-secondary bg-secondary/15 text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
              )}
            >
              Todos
            </button>
            {presentes.map((k) => (
              <button
                key={k}
                onClick={() => setFiltro(k)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-[0.64rem] uppercase tracking-[0.16em] transition-colors",
                  filtro === k
                    ? "border-secondary bg-secondary/15 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                )}
              >
                {nombre.get(k) ?? k}
              </button>
            ))}
          </div>
        ) : null}
      </div>


      {isLoading ? (
        <p className="mt-10 text-muted-foreground">Cargando horarios…</p>
      ) : total === 0 ? (
        <p className="mt-10 text-muted-foreground">
          No hay clases publicadas en este rango. Escríbenos por WhatsApp y te
          avisamos en cuanto se abra el horario.
        </p>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {grupos.map((g) => (
            <section
              key={g.key}
              className="flex flex-col border border-border bg-background"
            >
              <header className="flex items-center gap-3 border-b border-border bg-muted/40 px-5 py-4">
                <BirdBadge size="sm" variant={3} />
                <h3 className="flex-1 text-[0.8rem] uppercase tracking-[0.16em]">
                  {nombre.get(g.key) ?? g.key}
                </h3>
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  {g.total} {g.total === 1 ? "sesión" : "sesiones"}
                </span>
              </header>

              <div className="max-h-[22rem] overflow-y-auto px-5">
                {g.dias.map(([day, items]) => (
                  <div key={day} className="py-4">
                    <p className="sticky top-0 z-[1] bg-background py-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
                      {day}
                    </p>
                    <ul className="mt-2 divide-y divide-border">
                      {items.map((c) => {
                        const full = c.taken >= c.capacity;
                        const mine = bookedIds.has(c.id);
                        const libres = Math.max(c.capacity - c.taken, 0);
                        return (
                          <li
                            key={c.id}
                            className="flex items-center justify-between gap-4 py-3"
                          >
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-3">
                                <span className="text-base tabular-nums">
                                  {timeLabel(c.starts_at)}
                                </span>
                                <span className="truncate text-sm text-muted-foreground">
                                  {c.instructor || c.room}
                                </span>
                              </div>
                              <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
                                {libres} lugares · {c.duration_min} min ·{" "}
                                {c.tokens_cost}{" "}
                                {c.tokens_cost === 1 ? "token" : "tokens"}
                              </p>
                            </div>
                            {mine ? (
                              <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.16em] text-secondary">
                                Reservada
                              </span>
                            ) : (
                              <button
                                disabled={full || book.isPending}
                                onClick={() =>
                                  user
                                    ? book.mutate(c.id)
                                    : navigate({ to: "/auth" })
                                }
                                className="shrink-0 border border-foreground px-4 py-1.5 text-[0.62rem] uppercase tracking-[0.16em] transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                {full ? "Lleno" : "Reservar"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!user ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Puedes ver los horarios sin cuenta.{" "}
          <Link to="/auth" className="border-b border-current pb-0.5 text-foreground">
            Entra o regístrate
          </Link>{" "}
          para reservar.
        </p>
      ) : null}
    </div>
  );
}

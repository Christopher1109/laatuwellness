import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
    <div className={cn("flex flex-wrap gap-2", className)}>
      {RANGOS.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={cn(
            "border px-5 py-2.5 text-[0.68rem] uppercase tracking-[0.18em] transition-colors",
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

/**
 * Agenda de clases con reserva. Si se pasa `moduleKey`, sólo muestra las
 * clases de ese programa.
 */
export function Schedule({
  moduleKey,
  defaultRange = "semana",
  showTabs = true,
  limit,
}: {
  moduleKey?: string;
  defaultRange?: Rango;
  showTabs?: boolean;
  limit?: number;
}) {
  const [rango, setRango] = useState<Rango>(defaultRange);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { from, to } = rangeBounds(rango);

  const { data: classes, isLoading } = useQuery({
    queryKey: ["classes", moduleKey ?? "all", rango],
    queryFn: async () => {
      let q = supabase
        .from("classes")
        .select("*")
        .eq("active", true)
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at");
      if (moduleKey) q = q.eq("module_key", moduleKey);
      const { data, error } = await q.limit(80);
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

  const visible = limit ? (classes ?? []).slice(0, limit) : (classes ?? []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const c of visible) {
      const key = dayLabel(c.starts_at);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div>
      {showTabs ? <RangeTabs value={rango} onChange={setRango} /> : null}

      {isLoading ? (
        <p className="mt-10 text-muted-foreground">Cargando horarios…</p>
      ) : grouped.length === 0 ? (
        <p className="mt-10 text-muted-foreground">
          No hay clases publicadas en este rango. Escríbenos por WhatsApp y te
          avisamos en cuanto se abra el horario.
        </p>
      ) : (
        <div className="mt-10 space-y-12">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <h3 className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                {day}
              </h3>
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {(items ?? []).map((c) => {
                  const full = c.taken >= c.capacity;
                  const mine = bookedIds.has(c.id);
                  return (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-4 py-5"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                        <span className="w-20 text-lg tabular-nums">
                          {timeLabel(c.starts_at)}
                        </span>
                        <span className="text-sm">{c.room}</span>
                        <span className="text-sm text-muted-foreground">
                          {c.instructor}
                        </span>
                        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                          {Math.max(c.capacity - c.taken, 0)} lugares · {c.duration_min} min
                        </span>
                      </div>
                      {mine ? (
                        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-secondary">
                          Reservada
                        </span>
                      ) : (
                        <button
                          disabled={full || book.isPending}
                          onClick={() =>
                            user ? book.mutate(c.id) : navigate({ to: "/auth" })
                          }
                          className="border border-foreground px-5 py-2 text-[0.66rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-35"
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

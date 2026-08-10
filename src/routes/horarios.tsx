import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/horarios")({
  head: () => ({
    meta: [
      { title: "Horarios y reservas — Läätu Wellness" },
      {
        name: "description",
        content:
          "Consulta los horarios del estudio y reserva tu clase de Reformer con tus tokens. Cupo máximo de 10 personas por salón.",
      },
      { property: "og:title", content: "Horarios y reservas — Läätu Wellness" },
      {
        property: "og:description",
        content: "Reserva tu clase de Pilates Reformer en Läätu Wellness.",
      },
    ],
  }),
  component: Horarios,
});

const ERRORS: Record<string, string> = {
  WAIVER_REQUIRED: "Necesitas firmar el waiver antes de reservar.",
  INSUFFICIENT_TOKENS: "No tienes tokens suficientes. Compra un paquete para continuar.",
  CLASS_FULL: "Esta clase ya está llena.",
  ALREADY_BOOKED: "Ya tienes esta clase reservada.",
  CLASS_PAST: "Esta clase ya pasó.",
  AUTH_REQUIRED: "Inicia sesión para reservar.",
};

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Horarios() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: classes, isLoading } = useQuery({
    queryKey: ["classes", "upcoming"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("active", true)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(60);
      if (error) throw error;

      const withSeats = await Promise.all(
        data.map(async (c) => {
          const { data: taken } = await supabase.rpc("class_seats_taken", {
            _class_id: c.id,
          });
          return { ...c, taken: (taken as number | null) ?? 0 };
        }),
      );
      return withSeats;
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

  const grouped = useMemo(() => {
    const map = new Map<string, typeof classes>();
    for (const c of classes ?? []) {
      const key = dayLabel(c.starts_at);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [classes]);

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Horarios"
        title="Reserva tu espacio."
        intro="Un token por clase. Necesitas el waiver firmado y saldo disponible para confirmar tu lugar."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          {!user ? (
            <div className="mb-12 border border-border p-6 text-sm">
              <p>
                Puedes ver los horarios sin cuenta.{" "}
                <Link to="/auth" className="border-b border-foreground pb-0.5">
                  Entra o regístrate
                </Link>{" "}
                para reservar.
              </p>
            </div>
          ) : null}

          {isLoading ? (
            <p className="text-muted-foreground">Cargando horarios…</p>
          ) : grouped.length === 0 ? (
            <p className="text-muted-foreground">
              Aún no hay clases publicadas. El horario definitivo se carga desde
              el panel del estudio.
            </p>
          ) : (
            <div className="space-y-14">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
                    {day}
                  </h2>
                  <ul className="mt-5 divide-y divide-border border-y border-border">
                    {(items ?? []).map((c) => {
                      const full = c.taken >= c.capacity;
                      const mine = bookedIds.has(c.id);
                      return (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-4 py-5"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                            <span className="w-20 text-lg">{timeLabel(c.starts_at)}</span>
                            <span className="text-sm">{c.room}</span>
                            <span className="text-sm text-muted-foreground">
                              {c.instructor}
                            </span>
                            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              {Math.max(c.capacity - c.taken, 0)} lugares
                            </span>
                          </div>
                          {mine ? (
                            <span className="text-xs uppercase tracking-[0.16em] text-secondary">
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
                              className="border border-foreground px-5 py-2 text-[0.7rem] uppercase tracking-[0.16em] transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-35"
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
        </div>
      </section>
    </SiteLayout>
  );
}

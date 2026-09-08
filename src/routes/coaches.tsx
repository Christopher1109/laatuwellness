import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { BirdBadge } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/coaches")({
  head: () => ({
    meta: [
      { title: "Coaches — Läätu Wellness" },
      {
        name: "description",
        content:
          "Las instructoras que acompañan tu proceso en Läätu: reformer, movilidad y recuperación.",
      },
      { property: "og:title", content: "Coaches — Läätu Wellness" },
      {
        property: "og:description",
        content: "Conoce al equipo que acompaña tu recorrido en Läätu Wellness.",
      },
    ],
  }),
  component: Coaches,
});

type Coach = {
  id: string;
  name: string;
  specialty: string | null;
  bio: string | null;
  image_url: string | null;
};

/** Foto del coach si carga bien; si no hay foto o la URL está rota, cae al
 * ave de la marca en vez de dejar un recuadro vacío. */
function CoachAvatar({ coach, variant }: { coach: Coach; variant: 1 | 2 | 3 }) {
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(coach.image_url) && !broken;
  return (
    <div className="constellation grain flex aspect-[3/4] items-center justify-center bg-muted">
      {showPhoto ? (
        <img
          src={coach.image_url!}
          alt={coach.name}
          loading="lazy"
          className="h-full w-full object-cover grayscale"
          onError={() => setBroken(true)}
        />
      ) : (
        <BirdBadge variant={variant} />
      )}
    </div>
  );
}

function CoachCard({
  coach,
  variant,
  onClick,
}: {
  coach: Coach;
  variant: 1 | 2 | 3;
  onClick: () => void;
}) {
  return (
    <article
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="w-[16rem] shrink-0 cursor-pointer bg-background p-6 transition-colors hover:bg-muted sm:w-[18rem] sm:p-8"
    >
      <CoachAvatar coach={coach} variant={variant} />
      <h2 className="mt-6 text-lg">{coach.name}</h2>
      {coach.specialty ? <p className="eyebrow mt-1">{coach.specialty}</p> : null}
      {coach.bio ? <p className="mt-3 text-sm text-muted-foreground">{coach.bio}</p> : null}
      <p className="mt-3 text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground underline">
        Ver horario
      </p>
    </article>
  );
}

type ClassRow = {
  id: string;
  starts_at: string;
  room: string;
  module_key: string;
  capacity: number;
};

function CoachScheduleModal({ coach, onClose }: { coach: Coach; onClose: () => void }) {
  // La tabla pública "coaches" (bios/fotos) no está ligada por id a
  // staff_profiles (la de horarios/nómina) — se busca por nombre.
  const { data: staffMatch } = useQuery({
    queryKey: ["coach-staff-match", coach.name],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id")
        .eq("role", "coach")
        .ilike("full_name", coach.name)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: classes, isLoading } = useQuery({
    queryKey: ["coach-public-schedule", staffMatch?.id],
    enabled: Boolean(staffMatch?.id),
    queryFn: async () => {
      const from = new Date();
      const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("classes")
        .select("id, starts_at, room, module_key, capacity")
        .eq("coach_id", staffMatch!.id)
        .eq("active", true)
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data as ClassRow[];
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10"
      onClick={onClose}
    >
      <div className="w-full max-w-lg bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="eyebrow">Próximos 7 días</p>
            <h3 className="mt-2 text-lg">{coach.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="border border-input px-4 py-2 text-[0.66rem] uppercase tracking-[0.16em]"
          >
            Cerrar
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-6">
          {!staffMatch ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay horario público para {coach.name}.
            </p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (classes ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin clases programadas en los próximos 7 días.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(classes ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span>
                    {new Intl.DateTimeFormat("es-MX", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(c.starts_at))}
                  </span>
                  <span className="text-muted-foreground">{c.room}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Coaches() {
  const { data } = useQuery({
    queryKey: ["coaches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coaches")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Coach[];
    },
  });

  const [selected, setSelected] = useState<Coach | null>(null);

  const coaches = data ?? [];
  // Se duplica la lista para que el carrusel gire de forma continua sin
  // salto visible; solo tiene sentido si hay suficientes coaches para llenar
  // la pantalla dos veces.
  const track = coaches.length > 0 ? [...coaches, ...coaches] : [];

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Coaches"
        title="Alguien que mira tu proceso."
        intro="El equipo que acompaña tu proceso en Läätu."
      />

      <section className="border-b border-border py-16 sm:py-24">
        <div className="group overflow-hidden">
          <div className="animate-coach-marquee flex w-max gap-px bg-border group-hover:[animation-play-state:paused] motion-reduce:animate-none">
            {track.map((c, i) => (
              <CoachCard
                key={`${c.id}-${i}`}
                coach={c}
                variant={((i % 3) + 1) as 1 | 2 | 3}
                onClick={() => setSelected(c)}
              />
            ))}
          </div>
        </div>
      </section>

      {selected ? (
        <CoachScheduleModal coach={selected} onClose={() => setSelected(null)} />
      ) : null}
    </SiteLayout>
  );
}

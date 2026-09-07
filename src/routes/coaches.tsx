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

function CoachCard({ coach, variant }: { coach: Coach; variant: 1 | 2 | 3 }) {
  return (
    <article className="w-[16rem] shrink-0 bg-background p-6 sm:w-[18rem] sm:p-8">
      <CoachAvatar coach={coach} variant={variant} />
      <h2 className="mt-6 text-lg">{coach.name}</h2>
      {coach.specialty ? <p className="eyebrow mt-1">{coach.specialty}</p> : null}
      {coach.bio ? <p className="mt-3 text-sm text-muted-foreground">{coach.bio}</p> : null}
    </article>
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
              <CoachCard key={`${c.id}-${i}`} coach={c} variant={((i % 3) + 1) as 1 | 2 | 3} />
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

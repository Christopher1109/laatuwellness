import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site-chrome";
import { Constellation, Coordinates, BirdBadge, Wordmark } from "@/components/brand";
import { Schedule } from "@/components/schedule";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import foto1 from "@/assets/laatu-foto-1.jpg.asset.json";
import foto2 from "@/assets/laatu-foto-2.jpg.asset.json";
import foto3 from "@/assets/laatu-foto-3.jpg.asset.json";
import foto4 from "@/assets/laatu-foto-4.jpg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Läätu Wellness — Pilates Reformer y recuperación en Monterrey" },
      {
        name: "description",
        content:
          "Estudio de Pilates Reformer, terapia de contraste, nutrición y psicología. Reserva tu clase, consulta horarios y encuentra paz en el caos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Läätu Wellness — Encuentra paz en el caos" },
      {
        property: "og:description",
        content:
          "Pilates Reformer, contraste, nutrición y psicología en un solo lugar. Reserva tu clase.",
      },
    ],
  }),
  component: Home,
});

function Home() {
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

  const programas = (modules ?? []).filter((m) => m.category !== "bar");

  return (
    <SiteLayout>
      {/* ---------- Bienvenida ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-stretch gap-0 px-5 sm:px-8 lg:grid-cols-[1.05fr_1fr]">
          <div className="flex flex-col justify-center py-20 pr-0 lg:py-32 lg:pr-16">
            <Coordinates className="rise" />
            <h1 className="statement rise mt-8 text-[clamp(2.8rem,7.5vw,5.5rem)] leading-[0.95]">
              Encuentra paz
              <br />
              en el caos.
            </h1>
            <p className="rise mt-8 max-w-md text-lg text-muted-foreground">
              Pilates Reformer, recuperación y acompañamiento en un mismo lugar.
              Máximo diez personas por salón, para que alguien mire tu proceso.
            </p>
            <div className="rise mt-10 flex flex-wrap gap-3">
              <Link
                to="/horarios"
                className="bg-foreground px-8 py-4 text-[0.72rem] uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-85"
              >
                Reservar tu clase
              </Link>
              <Link
                to="/programas"
                className="border border-foreground px-8 py-4 text-[0.72rem] uppercase tracking-[0.2em] transition-colors hover:bg-foreground hover:text-background"
              >
                Conocer los programas
              </Link>
            </div>
          </div>

          <div className="relative -mx-5 min-h-[24rem] sm:-mx-8 lg:mx-0 lg:min-h-full">
            <img
              src={foto1.url}
              alt="Persona estirando en el estudio Läätu"
              className="h-full w-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </section>

      {/* ---------- Horarios ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">Horarios</p>
              <h2 className="statement mt-4 text-[clamp(1.9rem,4.5vw,3rem)]">
                Reserva tu lugar.
              </h2>
            </div>
            <Link
              to="/horarios"
              className="text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              Ver agenda completa →
            </Link>
          </div>

          <div className="mt-12">
            <Schedule defaultRange="hoy" limit={6} />
          </div>
        </div>
      </section>

      {/* ---------- Frase ---------- */}
      <section className="surface-dark grain">
        <div className="relative z-[2] mx-auto max-w-3xl px-5 py-28 text-center sm:px-8">
          <Constellation className="mx-auto max-w-xs opacity-60" />
          <p className="statement mt-10 text-[clamp(1.6rem,4vw,2.6rem)] leading-[1.15]">
            Date un espacio para respirar.
          </p>
          <p className="mt-6 font-mono text-[0.68rem] uppercase tracking-[0.24em] opacity-70">
            @laatu
          </p>
        </div>
      </section>

      {/* ---------- Programas ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Programas</p>
          <h2 className="statement mt-4 max-w-xl text-[clamp(1.9rem,4.5vw,3rem)]">
            Todo el recorrido, bajo un mismo techo.
          </h2>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {programas.map((m, i) => {
              const resto = programas.length % 3;
              const enUltimaFila = i >= programas.length - resto && resto !== 0;
              const offset =
                resto === 2 && i === programas.length - 2
                  ? "lg:col-start-2"
                  : resto === 1 && enUltimaFila
                    ? "lg:col-start-3"
                    : "";
              return (
                <Link
                  key={m.key}
                  to="/programas/$key"
                  params={{ key: m.key }}
                  className={cn(
                    "group flex flex-col border border-border bg-background p-8 transition-colors hover:bg-muted lg:col-span-2",
                    offset,
                  )}
                >
                  <BirdBadge />
                  <h3 className="mt-6 text-xl">{m.name}</h3>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {m.description}
                  </p>
                  <span className="mt-auto pt-6 text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors group-hover:text-foreground">
                    Ver horarios →
                  </span>
                </Link>
              );
            })}
          </div>

        </div>
      </section>

      {/* ---------- Recovery Bar ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2">
          <img
            src={foto4.url}
            alt="Recuperación después de entrenar en Läätu"
            className="aspect-[4/5] w-full object-cover"
            loading="lazy"
          />
          <div>
            <p className="eyebrow">Recovery Bar</p>
            <h2 className="statement mt-4 text-[clamp(1.8rem,4vw,2.8rem)]">
              Lo que tu cuerpo pide después.
            </h2>
            <p className="mt-6 text-muted-foreground">
              Smoothies de proteína, shots, infusiones y café de especialidad.
              Nuestra barra vive dentro del estudio y se ordena ahí mismo.
            </p>
            <Link
              to="/recovery-bar"
              className="mt-8 inline-block border border-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
            >
              Ver la barra
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Conócenos ---------- */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="eyebrow">Conócenos</p>
              <h2 className="statement mt-4 text-[clamp(1.8rem,4vw,2.8rem)]">
                Diez personas por salón.
              </h2>
              <p className="mt-6 text-muted-foreground">
                No creemos en las clases multitudinarias. Grupos pequeños,
                corrección individual y un ritmo que respeta tu cuerpo. Ser
                flexible no es una debilidad.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  to="/nosotros"
                  className="border border-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
                >
                  Nuestra historia
                </Link>
                <Link
                  to="/coaches"
                  className="px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
                >
                  Conoce a los coaches
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <img
                src={foto3.url}
                alt="Acompañamiento entre coach y alumna"
                className="aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
              <img
                src={foto2.url}
                alt="Entrenamiento de fuerza en Läätu"
                className="mt-10 aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Cierre ---------- */}
      <section className="surface-dark constellation grain">
        <div className="relative z-[2] mx-auto max-w-3xl px-5 py-28 text-center sm:px-8">
          <Wordmark tone="ivory" variant="stack" className="mx-auto h-24" />
          <p className="statement mt-10 text-[clamp(1.6rem,4vw,2.4rem)]">
            Abraza tu recorrido.
          </p>
          <Link
            to="/horarios"
            className="mt-10 inline-block bg-ivory px-8 py-4 text-[0.72rem] uppercase tracking-[0.18em] text-shadow"
          >
            Reservar tu clase
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}

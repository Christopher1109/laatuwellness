import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site-chrome";
import { Constellation, Coordinates, BirdBadge, Wordmark, PatternField } from "@/components/brand";
import { Schedule } from "@/components/schedule";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import foto1 from "@/assets/laatu-foto-1.jpg.asset.json";
import foto2 from "@/assets/laatu-foto-2.jpg.asset.json";
import foto3 from "@/assets/laatu-foto-3.jpg.asset.json";
import foto4 from "@/assets/laatu-foto-4.jpg.asset.json";

// Set editorial nuevo (matte black & white) — reemplaza foto1 (persona
// estirando) en el hero y complementa Fuel / Conócenos.
const editorial1 = "/foto-editorial/laatu-editorial-1.jpg";
const editorial2 = "/foto-editorial/laatu-editorial-2.jpg";
const editorial3 = "/foto-editorial/laatu-editorial-3.jpg";
void foto1;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Läätu Wellness — Pilates Reformer y recuperación en Monterrey" },
      {
        name: "description",
        content:
          "Estudio de Pilates Reformer, 4mat, Align y terapia de contraste. Reserva tu clase, consulta horarios y encuentra paz en el caos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Läätu Wellness — Ábrete a la posibilidad del camino" },
      {
        property: "og:description",
        content:
          "Pilates Reformer, 4mat, Align y Contrast en un solo lugar. Reserva tu clase.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();

  // En celular, la experiencia principal es la app (horarios, reservas,
  // créditos, tienda) — no esta página informativa. Se detecta por ancho
  // de pantalla (más confiable entre navegadores que el user-agent) y se
  // manda directo, sin preguntar.
  useEffect(() => {
    if (window.innerWidth < 768) {
      navigate({ to: "/app", replace: true });
    }
  }, [navigate]);

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
          <div className="flex flex-col justify-center py-14 pr-0 sm:py-20 lg:py-32 lg:pr-16">
            <Coordinates className="rise" />
            <h1 className="statement rise mt-6 text-[clamp(2.6rem,10vw,5.5rem)] leading-[0.95] sm:mt-8">
              Ábrete a la posibilidad
              <br />
              del camino.
            </h1>
            <p className="rise mt-6 max-w-md text-base text-muted-foreground sm:mt-8 sm:text-lg">
              Pilates Reformer, clases en Mat y recuperación en un mismo lugar. Diez personas
              por salón.
            </p>
            <div className="rise mt-8 grid grid-cols-1 gap-3 sm:mt-10 sm:flex sm:flex-wrap">
              <Link
                to="/horarios"
                className="bg-foreground px-8 py-4 text-center text-[0.72rem] uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-85"
              >
                Reservar tu clase
              </Link>
              <Link
                to="/programas"
                className="border border-foreground px-8 py-4 text-center text-[0.72rem] uppercase tracking-[0.2em] transition-colors hover:bg-foreground hover:text-background"
              >
                Conocer los programas
              </Link>
            </div>
          </div>

          <div className="relative -mx-5 min-h-[19rem] sm:-mx-8 sm:min-h-[24rem] lg:mx-0 lg:min-h-full">
            <img
              src={editorial1}
              alt="Coach en movimiento en el estudio Läätu"
              className="h-full w-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </section>

      {/* ---------- Horarios ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">Horarios</p>
              <h2 className="statement mt-4 text-[clamp(1.9rem,4.5vw,3rem)]">Reserva tu lugar.</h2>
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
      <section className="surface-dark grain relative overflow-hidden">
        <PatternField
          tone="ivory"
          opacity={0.18}
          className="-left-40 top-1/2 h-[34rem] w-[34rem] -translate-y-1/2"
        />
        <div className="relative z-[2] mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 sm:py-28">
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
      <section className="relative overflow-hidden border-b border-border">
        <PatternField opacity={0.1} className="-right-32 -top-24 h-[30rem] w-[30rem]" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="eyebrow">Programas</p>
          <h2 className="statement mt-4 max-w-xl text-[clamp(1.9rem,4.5vw,3rem)]">
            Todo el recorrido, bajo un mismo techo.
          </h2>

          <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-6">
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
                    "group flex flex-col border border-border bg-background p-6 transition-colors sm:p-8 hover:bg-muted lg:col-span-2",
                    offset,
                  )}
                >
                  <BirdBadge variant={((i % 3) + 1) as 1 | 2 | 3} />
                  <h3 className="mt-6 text-xl">{m.name}</h3>
                  <p className="mt-3 text-sm text-muted-foreground">{m.description}</p>
                  <span className="mt-auto pt-6 text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors group-hover:text-foreground">
                    Ver horarios →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- Fuel ---------- */}
      <section className="surface-dark grain relative overflow-hidden border-b border-border">
        <PatternField
          tone="ivory"
          opacity={0.12}
          className="-right-40 -top-32 h-[32rem] w-[32rem]"
        />
        <div className="relative z-[2] mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow opacity-70">Fuel</p>
              <h2 className="statement mt-4 max-w-lg text-[clamp(1.8rem,4vw,2.8rem)]">
                Lo que tu cuerpo pide después.
              </h2>
            </div>
            <Link
              to="/fuel"
              className="text-[0.7rem] uppercase tracking-[0.18em] opacity-70 transition-opacity hover:opacity-100"
            >
              Ver la carta completa →
            </Link>
          </div>

          <div className="mt-12 grid gap-px bg-current/15 sm:mt-16 md:grid-cols-3">
            {[
              ["01", "Smoothies", "Blush, Indigo, Lift y Verde. Preparados al momento, $125."],
              [
                "02",
                "Coffee & Matcha",
                "Latte, capu, flat, brew y matcha. Leches vegetales sin costo extra.",
              ],
              ["03", "Add-ons", "Proteína, colágeno y jarabes de temporada."],
            ].map(([num, titulo, desc]) => (
              <div key={num} className="surface-dark p-6 sm:p-8">
                <p className="font-mono text-[0.65rem] tracking-[0.24em] opacity-60">{num}</p>
                <h3 className="mt-6 text-xl">{titulo}</h3>
                <p className="mt-3 text-sm opacity-70">{desc}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 max-w-xl font-mono text-[0.65rem] uppercase leading-relaxed tracking-[0.2em] opacity-60">
            Fuel vive dentro del estudio · pide lo que se te antoje
          </p>
        </div>
      </section>

      {/* ---------- Conócenos ---------- */}
      <section className="relative overflow-hidden">
        <PatternField opacity={0.08} className="-left-48 bottom-0 h-[26rem] w-[26rem]" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="eyebrow">Conócenos</p>
              <h2 className="statement mt-4 text-[clamp(1.8rem,4vw,2.8rem)]">
                Diez personas por salón.
              </h2>
              <p className="mt-6 text-muted-foreground">
                Grupos pequeños de diez personas, corrección individual y un ritmo que respeta tu
                cuerpo. Ser flexible no es una debilidad.
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
                src={editorial2}
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
      <section className="surface-dark constellation grain relative overflow-hidden">
        <PatternField
          tone="ivory"
          opacity={0.16}
          className="-bottom-40 -right-40 h-[38rem] w-[38rem]"
        />
        <div className="relative z-[2] mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 sm:py-28">
          <Wordmark tone="ivory" variant="stack" className="mx-auto h-24" />
          <p className="statement mt-10 text-[clamp(1.6rem,4vw,2.4rem)]">Abraza tu recorrido.</p>
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

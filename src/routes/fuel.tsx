import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Constellation, BirdBadge, PatternField } from "@/components/brand";
import { whatsappHref } from "@/components/whatsapp-button";
import { supabase } from "@/integrations/supabase/client";
import foto4 from "@/assets/laatu-foto-4.jpg.asset.json";

const LECHES = "Almendra, avena, coco o deslactosada light.";

const SMOOTHIES = [
  {
    nombre: "Blush",
    desc: "Leche de almendra, fresa, frambuesa, plátano, sal de mar y crema de almendra.",
  },
  {
    nombre: "Indigo",
    desc: "Leche de almendra, blueberries, spirulina azul, plátano, miel de agave y vainilla.",
  },
  {
    nombre: "Lift",
    desc: "Leche de almendra, cacao, cold brew, crema de almendra, plátano y maca en polvo.",
  },
  {
    nombre: "Verde",
    desc: "Leche de almendra, matcha, espinaca, plátano, piña y crema de almendra.",
  },
];

const SMOOTHIE_ADDONS = [
  ["Proteína whey Easy Fit", "+$35"],
  ["Proteína vegetal Habits", "+$35"],
  ["Colágeno", "+$30"],
  ["Miel de agave", "Sin costo"],
];

const COFFEE = [
  ["Latte", "$105", "Hot / Iced"],
  ["Capu", "$80", "Hot"],
  ["Flat", "$90", "Hot"],
  ["Brew", "$105", "Iced"],
  ["Matcha", "$105", "Hot / Iced"],
];

const COFFEE_ADDONS = [
  ["Jarabe vainilla", "+$15"],
  ["Jarabe canela", "+$15"],
  ["Jarabe de temporada", "+$15"],
];

export const Route = createFileRoute("/fuel")({
  head: () => ({
    meta: [
      { title: "Fuel — Läätu Wellness" },
      {
        name: "description",
        content:
          "Smoothies de proteína, café y matcha de especialidad dentro del estudio Läätu. Ordena en Fuel después de tu clase.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Fuel — Läätu Wellness" },
      {
        property: "og:description",
        content: "Fuel: la barra de recuperación de Läätu. Smoothies, café, matcha e hidratación.",
      },
    ],
  }),
  component: Fuel,
});

function Fuel() {
  const { data: modulo } = useQuery({
    queryKey: ["site-module", "fuel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_modules")
        .select("*")
        .eq("key", "fuel")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Fuel"
        title="Lo que tu cuerpo pide después."
        intro={
          modulo?.long_description ||
          "Fuel vive dentro del estudio. Se ordena y se paga ahí mismo, después de tu clase."
        }
      />

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-2">
          <img
            src={foto4.url}
            alt="Hidratación y recuperación después de entrenar"
            className="aspect-[4/5] w-full object-cover"
            loading="lazy"
          />
          <div>
            <Constellation className="max-w-xs opacity-50" />
            <p className="statement mt-8 text-[clamp(1.5rem,3.5vw,2.2rem)] leading-tight">
              La recuperación también es entrenamiento.
            </p>
            <p className="mt-6 text-muted-foreground">
              Todo se prepara al momento, con ingredientes simples y sin azúcares añadidos
              innecesarios. Pregunta por las opciones sin lácteos.
            </p>
            <a
              href={whatsappHref("Hola Läätu, quiero saber más sobre Fuel.")}
              target="_blank"
              rel="noreferrer"
              className="mt-9 inline-block border border-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
            >
              Preguntar por WhatsApp
            </a>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden">
        <PatternField opacity={0.08} className="-right-36 top-10 h-[28rem] w-[28rem]" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="eyebrow">La carta</p>
          <h2 className="statement mt-4 text-[clamp(1.7rem,4vw,2.6rem)]">Solo en el estudio.</h2>

          <div className="mt-10 sm:mt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
                Smoothies
              </h3>
              <p className="font-mono text-sm tabular-nums text-muted-foreground">$125 c/u</p>
            </div>
            <div className="mt-6 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              {SMOOTHIES.map((s, i) => (
                <div key={s.nombre} className="bg-background p-6 sm:p-8">
                  <BirdBadge size="sm" variant={((i % 3) + 1) as 1 | 2 | 3} />
                  <p className="mt-6 text-lg">{s.nombre}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 border border-border p-6 sm:p-8">
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                Add-ons
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {SMOOTHIE_ADDONS.map(([nombre, precio]) => (
                  <li
                    key={nombre}
                    className="flex items-center justify-between gap-4 text-sm text-muted-foreground"
                  >
                    <span>{nombre}</span>
                    <span className="font-mono tabular-nums">{precio}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-14 sm:mt-20">
            <h3 className="text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
              Coffee &amp; Matcha
            </h3>
            <div className="mt-6 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              {COFFEE.map(([nombre, precio, modo], i) => (
                <div key={nombre} className="bg-background p-6 sm:p-8">
                  <BirdBadge size="sm" variant={((i % 3) + 1) as 1 | 2 | 3} />
                  <div className="mt-6 flex items-baseline justify-between gap-3">
                    <p className="text-lg">{nombre}</p>
                    <p className="font-mono text-sm tabular-nums text-muted-foreground">{precio}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{modo}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-px bg-border sm:grid-cols-2">
              <div className="border border-border bg-background p-6 sm:p-8">
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                  Leches
                </p>
                <p className="mt-3 text-sm text-muted-foreground">{LECHES}</p>
              </div>
              <div className="border border-border bg-background p-6 sm:p-8">
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                  Jarabes
                </p>
                <ul className="mt-3 space-y-1">
                  {COFFEE_ADDONS.map(([nombre, precio]) => (
                    <li
                      key={nombre}
                      className="flex items-center justify-between gap-4 text-sm text-muted-foreground"
                    >
                      <span>{nombre}</span>
                      <span className="font-mono tabular-nums">{precio}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
            Precios en MXN · disponibilidad en el estudio
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

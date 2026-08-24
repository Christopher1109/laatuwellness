import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Constellation, BirdBadge, PatternField } from "@/components/brand";
import { whatsappHref } from "@/components/whatsapp-button";
import { supabase } from "@/integrations/supabase/client";
import foto4 from "@/assets/laatu-foto-4.jpg.asset.json";

const CARTA = [
  {
    grupo: "Smoothies de proteína",
    items: [
      ["Recovery", "Proteína, plátano, cacao y mantequilla de almendra."],
      ["Verde", "Proteína, espinaca, piña, jengibre y agua de coco."],
      ["Berry", "Proteína, frutos rojos, yogurt griego y linaza."],
    ],
  },
  {
    grupo: "Café de especialidad",
    items: [
      ["Espresso", "Grano de origen, tostado medio."],
      ["Latte de avena", "Sin azúcar añadida."],
      ["Cold brew", "Reposado 18 horas."],
    ],
  },
  {
    grupo: "Shots e infusiones",
    items: [
      ["Shot de jengibre", "Cúrcuma, limón y pimienta."],
      ["Electrolitos", "Hidratación después del contraste."],
      ["Infusión relajante", "Manzanilla, lavanda y menta."],
    ],
  },
];

export const Route = createFileRoute("/recovery-bar")({
  head: () => ({
    meta: [
      { title: "Recovery Bar — Läätu Wellness" },
      {
        name: "description",
        content:
          "Smoothies de proteína, café de especialidad, shots e infusiones dentro del estudio Läätu. Ordena en sitio después de tu clase.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Recovery Bar — Läätu Wellness" },
      {
        property: "og:description",
        content: "La barra de recuperación de Läätu: proteína, café de especialidad e hidratación.",
      },
    ],
  }),
  component: RecoveryBar,
});

function RecoveryBar() {
  const { data: modulo } = useQuery({
    queryKey: ["site-module", "recovery-bar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_modules")
        .select("*")
        .eq("key", "recovery-bar")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Recovery Bar"
        title="Lo que tu cuerpo pide después."
        intro={
          modulo?.long_description ||
          "Nuestra barra de recuperación vive dentro del estudio. Se ordena y se paga ahí mismo."
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
              href={whatsappHref("Hola Läätu, quiero saber más sobre el Recovery Bar.")}
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
          <div className="mt-10 grid gap-px sm:mt-14 bg-border md:grid-cols-3">
            {CARTA.map((g, i) => (
              <div key={g.grupo} className="bg-background p-6 sm:p-8">
                <BirdBadge size="sm" variant={((i % 3) + 1) as 1 | 2 | 3} />
                <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
                  {g.grupo}
                </h3>
                <ul className="mt-6 space-y-6">
                  {g.items.map(([nombre, desc]) => (
                    <li key={nombre}>
                      <p className="text-lg">{nombre}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
            Carta muestra · disponibilidad y precios en el estudio
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

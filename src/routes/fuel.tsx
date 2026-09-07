import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { BirdBadge } from "@/components/brand";
import { whatsappHref } from "@/components/whatsapp-button";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

const LECHES = "Almendra, avena, coco o deslactosada light.";

const SMOOTHIES = [
  {
    nombre: "Blush",
    desc: "Leche de almendra, fresa, frambuesa, plátano, sal de mar y crema de almendra.",
    precio: 12500,
  },
  {
    nombre: "Indigo",
    desc: "Leche de almendra, blueberries, spirulina azul, plátano, miel de agave y vainilla.",
    precio: 12500,
  },
  {
    nombre: "Lift",
    desc: "Leche de almendra, cacao, cold brew, crema de almendra, plátano y maca en polvo.",
    precio: 12500,
  },
  {
    nombre: "Verde",
    desc: "Leche de almendra, matcha, espinaca, plátano, piña y crema de almendra.",
    precio: 12500,
  },
];

const SMOOTHIE_ADDONS = [
  ["Proteína whey Easy Fit", "+$35"],
  ["Proteína vegetal Habits", "+$35"],
  ["Colágeno", "+$30"],
  ["Miel de agave", "Sin costo"],
];

const COFFEE = [
  { nombre: "Latte", precio: 10500, modo: "Hot / Iced" },
  { nombre: "Capu", precio: 8000, modo: "Hot" },
  { nombre: "Flat", precio: 9000, modo: "Hot" },
  { nombre: "Brew", precio: 10500, modo: "Iced" },
  { nombre: "Matcha", precio: 10500, modo: "Hot / Iced" },
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

  const { data: merch } = useQuery({
    queryKey: ["fuel-merch"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("category", "merch")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Tables<"products">[];
    },
  });

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Fuel"
        title="Lo que tu cuerpo pide después."
        intro={modulo?.long_description || "Fuel vive dentro del estudio. Pide lo que te gusta."}
      />

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="text-center text-lg text-muted-foreground">
            Pide tu favorito. Pruébanos, te esperamos después de tu clase.
          </p>

          {/* En escritorio la carta va en dos columnas (smoothies a la
              izquierda, café y matcha a la derecha); en tablet y celular se
              apila una debajo de otra. */}
          <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">Smoothies</p>
            <ul className="mt-4 divide-y divide-border">
              {SMOOTHIES.map((s) => (
                <li key={s.nombre} className="flex items-baseline justify-between gap-4 py-3">
                  <div>
                    <span className="text-base">{s.nombre}</span>
                    <span className="ml-3 text-xs text-muted-foreground">{s.desc}</span>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                    {money(s.precio)}
                  </span>
                </li>
              ))}
              {SMOOTHIE_ADDONS.map(([nombre, precio]) => (
                <li
                  key={nombre}
                  className="flex items-center justify-between gap-4 py-3 text-sm text-muted-foreground"
                >
                  <span>+ {nombre}</span>
                  <span className="font-mono tabular-nums">{precio}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="eyebrow">Coffee &amp; Matcha</p>
            <ul className="mt-4 divide-y divide-border">
              {COFFEE.map((c) => (
                <li key={c.nombre} className="flex items-baseline justify-between gap-4 py-3">
                  <div>
                    <span className="text-base">{c.nombre}</span>
                    <span className="ml-3 text-xs text-muted-foreground">{c.modo}</span>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                    {money(c.precio)}
                  </span>
                </li>
              ))}
              {COFFEE_ADDONS.map(([nombre, precio]) => (
                <li
                  key={nombre}
                  className="flex items-center justify-between gap-4 py-3 text-sm text-muted-foreground"
                >
                  <span>+ {nombre}</span>
                  <span className="font-mono tabular-nums">{precio}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">Leches: {LECHES}</p>
          </div>
          </div>


          <p className="mt-10 text-center font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
            Precios en MXN · disponibilidad en el estudio
          </p>
        </div>
      </section>

      {merch && merch.length > 0 ? (
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow">Merch</p>
            <h2 className="statement mt-4 text-[clamp(1.7rem,4vw,2.6rem)]">Para llevar.</h2>

            <div className="mt-10 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              {merch.map((p, i) => (
                <div key={p.id} className="flex flex-col bg-background p-6 sm:p-7">
                  <BirdBadge size="sm" variant={((i % 3) + 1) as 1 | 2 | 3} />
                  <div className="mt-6 flex items-baseline justify-between gap-3">
                    <p className="text-lg">{p.name}</p>
                    <p className="font-mono text-sm tabular-nums text-muted-foreground">
                      {money(p.price_cents)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-8 text-sm text-muted-foreground">
              Se compra en el estudio, en la app (sección Tienda) o preguntando por WhatsApp.
            </p>
            <a
              href={whatsappHref("Hola Läätu, quiero preguntar por el merch.")}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block border border-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
            >
              Preguntar por WhatsApp
            </a>
          </div>
        </section>
      ) : null}
    </SiteLayout>
  );
}

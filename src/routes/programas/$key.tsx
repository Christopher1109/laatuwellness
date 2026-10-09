import { createFileRoute, notFound } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site-chrome";
import { Coordinates } from "@/components/brand";
import { Schedule } from "@/components/schedule";
import { whatsappHref } from "@/components/whatsapp-button";
import { getPublicProgram } from "@/utils/public-catalog.functions";
import { PublicCatalogError, PublicCatalogNotFound } from "@/components/public-catalog-boundaries";

import foto1 from "@/assets/laatu-foto-1.jpg.asset.json";
import foto2 from "@/assets/laatu-foto-2.jpg.asset.json";
import foto3 from "@/assets/laatu-foto-3.jpg.asset.json";
import foto4 from "@/assets/laatu-foto-4.jpg.asset.json";

const editorial1 = "/foto-editorial/laatu-editorial-1.jpg";
void foto1;

const HERO: Record<string, string> = {
  reformer: editorial1,
  "4mat": foto2.url,
  contraste: foto4.url,
  nutricion: foto4.url,
  psicologia: foto3.url,
  rehabilitacion: foto3.url,
};

export const Route = createFileRoute("/programas/$key")({
  loader: async ({ params }) => {
    const program = await getPublicProgram({ data: { key: params.key } });
    if (!program) throw notFound();
    return program;
  },
  errorComponent: PublicCatalogError,
  notFoundComponent: PublicCatalogNotFound,
  head: ({ params, loaderData }) => {
    const nombres: Record<string, string> = {
      reformer: "Pilates Reformer en San Pedro Garza García",
      "4mat": "Clases de 4mat (Pilates en piso) en San Pedro Garza García",
      rehabilitacion: "Align: fisioterapia y rehabilitación en San Pedro Garza García",
      contraste: "Contrast: sauna infrarrojo y cold plunge en San Pedro Garza García",
    };
    const title = `${nombres[params.key] ?? loaderData?.modulo.name ?? `Programa ${params.key}`} — Läätu Wellness`;
    const source = (loaderData?.modulo.description || loaderData?.modulo.long_description || "")
      .replace(/\s+/g, " ").trim();
    const location = "San Pedro Garza García";
    const localized = source && !source.includes(location) && source.length + location.length + 5 <= 155
      ? `${source} · ${location}.` : source;
    const description = localized.length > 155
      ? `${localized.slice(0, 154).replace(/\s+\S*$/, "").trimEnd()}…`
      : localized;
    const image = HERO[params.key];
    const url = `https://laatuwellness.com/programas/${encodeURIComponent(params.key)}`;
    return {
      links: [{ rel: "canonical", href: url }],
      meta: [
        { title },
        { property: "og:url", content: url },
        ...(!loaderData ? [{ name: "robots", content: "noindex" }] : []),
        {
          name: "description",
          content: description || "Consulta los programas de Läätu Wellness en San Pedro Garza García.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:title", content: title },
        {
          property: "og:description",
          content: description || "Consulta los programas de Läätu Wellness en San Pedro Garza García.",
        },
        ...(image?.startsWith("https://") ? [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ] : []),
      ],
    };
  },
  component: ProgramaDetalle,
});

function ProgramaDetalle() {
  const { modulo, classTypes } = Route.useLoaderData();

  return (
    <SiteLayout>
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-0 px-5 sm:px-8 lg:grid-cols-[1fr_0.9fr]">
          <div className="flex flex-col justify-center py-20 lg:py-28 lg:pr-14">
            <Coordinates className="rise" />
            <p className="eyebrow rise mt-6">
              {modulo.category === "salon" ? "Movimiento" : "Recuperación"}
            </p>
            <h1 className="statement rise mt-5 text-[clamp(2.2rem,6vw,4rem)] leading-[1]">
              {modulo.name}
            </h1>
            <p className="rise mt-7 max-w-md text-lg text-muted-foreground">
              {modulo.long_description || modulo.description}
            </p>
            <div className="rise mt-9 flex flex-wrap gap-3">
              <a
                href="#horarios"
                className="bg-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85"
              >
                Ver horarios
              </a>
              <a
                href={whatsappHref(`Hola Läätu, quiero información sobre ${modulo.name}.`)}
                target="_blank"
                rel="noreferrer"
                className="border border-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
              >
                Preguntar por WhatsApp
              </a>
            </div>
          </div>
          <div className="relative -mx-5 min-h-[20rem] sm:-mx-8 lg:mx-0">
            <img
              src={HERO[modulo.key] ?? editorial1}
              alt={modulo.name}
              className="h-full w-full object-cover"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {classTypes && classTypes.length > 0 ? (
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <p className="eyebrow">Las clases de {modulo.name}</p>
            <h2 className="statement mt-4 max-w-xl text-[clamp(1.7rem,4vw,2.6rem)]">
              Cuatro formas de entrenar en este salón.
            </h2>
            <div className="mt-10 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              {classTypes.map((c, i) => (
                <div key={c.id} className="flex flex-col bg-background p-6 sm:p-7">
                  <p className="font-mono text-[0.65rem] tracking-[0.24em] text-muted-foreground">
                    0{i + 1}
                  </p>
                  <h3 className="mt-5 text-lg">{c.name}</h3>
                  {c.description ? (
                    <p className="mt-2 text-sm text-muted-foreground">{c.description}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section id="horarios" className="border-b border-border scroll-mt-28">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Horarios</p>
          <h2 className="statement mt-4 text-[clamp(1.7rem,4vw,2.6rem)]">Cupos en vivo.</h2>
          <div className="mt-12">
            <Schedule moduleKey={modulo.key} defaultRange="semana" />
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

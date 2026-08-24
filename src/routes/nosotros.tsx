import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Constellation } from "@/components/brand";
import studio from "@/assets/studio-space.jpg";

export const Route = createFileRoute("/nosotros")({
  head: () => ({
    meta: [
      { title: "Nosotros — Läätu Wellness" },
      {
        name: "description",
        content:
          "Salones íntimos de 10 personas, atención personalizada y una práctica pensada para la longevidad. Conoce la propuesta de Läätu.",
      },
      { property: "og:title", content: "Nosotros — Läätu Wellness" },
      {
        property: "og:description",
        content: "Atención personalizada en salones íntimos. Transformación consciente.",
      },
    ],
  }),
  component: Nosotros,
});

const VALORES = [
  {
    title: "El proceso, no la meta",
    body: "Medimos tu avance por tu constancia, no por una foto. Aplaude tus tropiezos: también son recorrido.",
  },
  {
    title: "Salones de diez",
    body: "Grupos pequeños para que tu instructora te vea toda la clase. Corrección real, ritmo propio.",
  },
  {
    title: "Longevidad",
    body: "Entrenamos para los próximos treinta años: fuerza, movilidad, respiración y sistema nervioso.",
  },
  {
    title: "Honestidad",
    body: "Sin promesas exageradas. Te decimos qué esperar, cuánto toma y qué depende de ti.",
  },
];

function Nosotros() {
  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Presentación"
        title="Ser flexible no es una debilidad."
        intro="Läätu es un estudio boutique de Pilates y recuperación. Un lugar honesto, silencioso y sin pretensión donde el movimiento se vuelve pausa."
      />

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-2">
          <div>
            <p className="eyebrow">La propuesta</p>
            <p className="mt-6 text-lg leading-relaxed">
              Trabajamos con reformer, con recuperación por contraste y con acompañamiento integral.
              Cada salón recibe un máximo de diez personas para que la atención sea individual
              dentro de un grupo.
            </p>
            <p className="mt-5 text-muted-foreground">
              No creemos en la intensidad como identidad. Creemos en la constancia, en la
              respiración y en el espacio que se abre cuando dejas de competir contigo.
            </p>
          </div>
          <img
            src={studio}
            alt="Espacio del estudio Läätu"
            loading="lazy"
            width={1600}
            height={1008}
            className="aspect-[4/3] w-full object-cover"
          />
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Constellation className="mb-14 opacity-50" />
          <div className="grid gap-px bg-border sm:grid-cols-2">
            {VALORES.map((v) => (
              <article key={v.title} className="bg-background p-8 sm:p-10">
                <h2 className="text-xl">{v.title}</h2>
                <p className="mt-3 text-sm text-muted-foreground">{v.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="surface-stone">
        <div className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8">
          <h2 className="statement text-[clamp(2rem,5vw,3.4rem)]">
            Ábrete a la posibilidad del camino.
          </h2>
        </div>
      </section>
    </SiteLayout>
  );
}

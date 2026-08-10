import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Schedule } from "@/components/schedule";

export const Route = createFileRoute("/horarios")({
  head: () => ({
    meta: [
      { title: "Horarios y reservas — Läätu Wellness" },
      {
        name: "description",
        content:
          "Consulta las clases de hoy, de esta semana y de la próxima, segmentadas por programa. Cupos en vivo y reserva en línea con tus tokens.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Horarios y reservas — Läätu Wellness" },
      {
        property: "og:description",
        content: "Cupos en vivo y reserva en línea en Läätu Wellness.",
      },
    ],
  }),
  component: Horarios,
});

function Horarios() {
  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Horarios"
        title="Reserva tu lugar."
        intro="Filtra por día y por programa. Los cupos se actualizan en tiempo real y puedes cancelar hasta 12 horas antes para recuperar tu token."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <Schedule defaultRange="hoy" />

          <p className="mt-16 text-sm text-muted-foreground">
            ¿No encuentras un horario que te acomode?{" "}
            <Link to="/contacto" className="border-b border-current pb-0.5 text-foreground">
              Escríbenos
            </Link>{" "}
            y buscamos un espacio.
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

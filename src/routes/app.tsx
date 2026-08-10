import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { BirdMark } from "@/components/brand";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "App Läätu — Próximamente" },
      {
        name: "description",
        content:
          "La app de Läätu Wellness llegará con reservas, tokens y seguimiento de tu proceso desde tu teléfono.",
      },
      { property: "og:title", content: "App Läätu — Próximamente" },
      {
        property: "og:description",
        content: "Reservas, tokens y tu recorrido, en tu teléfono. Muy pronto.",
      },
    ],
  }),
  component: AppSoon,
});

function AppSoon() {
  return (
    <SiteLayout>
      <PageHeader eyebrow="Próximamente" title="La app está en camino." />
      <section className="surface-dark constellation grain">
        <div className="relative z-[2] mx-auto max-w-3xl px-5 py-28 text-center sm:px-8">
          <BirdMark className="mx-auto h-10 w-10" />
          <h2 className="statement mt-10 text-[clamp(1.8rem,4.5vw,3rem)]">
            Hay belleza en el caos.
          </h2>
          <p className="mt-6 text-muted-foreground">
            Estamos construyendo la app de Läätu: reservas, saldo de tokens,
            recordatorios y tu historial de proceso. Mientras tanto, todo eso ya
            vive en tu cuenta web.
          </p>
          <Link
            to="/cuenta"
            className="mt-10 inline-block bg-ivory px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-shadow"
          >
            Ir a mi cuenta
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}

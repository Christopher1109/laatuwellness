import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { BirdBadge, PatternField } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import foto2 from "@/assets/laatu-foto-2.jpg.asset.json";

export const Route = createFileRoute("/programas/")({
  head: () => ({
    meta: [
      { title: "Programas — Läätu Wellness" },
      {
        name: "description",
        content:
          "Pilates Reformer, 4mat, Align y Contrast. Consulta horarios y reserva tu sesión.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Programas — Läätu Wellness" },
      {
        property: "og:description",
        content: "Reformer, 4mat, Align y Contrast en un mismo estudio.",
      },
    ],
  }),
  component: Programas,
});

function Programas() {
  const { data } = useQuery({
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

  const salones = (data ?? []).filter((m) => m.category === "salon");
  const servicios = (data ?? []).filter((m) => m.category === "servicio");

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Programas"
        title="Elige por dónde empezar."
        intro="Cada programa tiene su propio horario y su propio paquete de sesiones. Entra, revisa los cupos y reserva."
      />

      <section className="relative overflow-hidden border-b border-border">
        <PatternField opacity={0.09} className="-right-40 -top-32 h-[30rem] w-[30rem]" />
        <div className="relative mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <p className="eyebrow">Movimiento</p>
          <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-px bg-border">
              {salones.map((m, i) => (
                <Link
                  key={m.key}
                  to="/programas/$key"
                  params={{ key: m.key }}
                  className="group flex items-start gap-6 bg-background p-6 transition-colors sm:p-8 hover:bg-muted"
                >
                  <BirdBadge variant={((i % 3) + 1) as 1 | 2 | 3} className="mt-1" />
                  <span>
                    <span className="block text-xl">{m.name}</span>
                    <span className="mt-3 block text-sm text-muted-foreground">
                      {m.description}
                    </span>
                    <span className="mt-5 block text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground">
                      Ver horarios →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            <img
              src={foto2.url}
              alt="Sesión de entrenamiento en Läätu"
              className="aspect-[4/5] w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden">
        <PatternField opacity={0.07} className="-bottom-32 -left-40 h-[28rem] w-[28rem]" />
        <div className="relative mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <p className="eyebrow">Recuperación y acompañamiento</p>
          <h2 className="statement mt-4 max-w-xl text-[clamp(1.7rem,4vw,2.6rem)]">
            El proceso no termina en la clase.
          </h2>
          <div className="mt-10 grid gap-px sm:mt-12 bg-border sm:grid-cols-2">
            {servicios.map((m, i) => (
              <Link
                key={m.key}
                to="/programas/$key"
                params={{ key: m.key }}
                className="group bg-background p-6 transition-colors sm:p-8 hover:bg-muted"
              >
                <BirdBadge variant={((i % 3) + 1) as 1 | 2 | 3} />
                <h3 className="mt-6 text-xl">{m.name}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{m.description}</p>
                <span className="mt-6 inline-block text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground">
                  Ver horarios y sesiones →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

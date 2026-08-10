import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Schedule } from "@/components/schedule";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/horarios")({
  head: () => ({
    meta: [
      { title: "Horarios y reservas — Läätu Wellness" },
      {
        name: "description",
        content:
          "Consulta las clases de hoy, de esta semana y de la próxima. Cupos en vivo y reserva en línea con tus tokens.",
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
  const [modulo, setModulo] = useState<string | undefined>(undefined);

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

  const filtros = (modules ?? []).filter((m) => m.category !== "bar");

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Horarios"
        title="Reserva tu lugar."
        intro="Los cupos se actualizan en tiempo real. Cancela hasta 12 horas antes y recuperas tu token."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setModulo(undefined)}
              className={cn(
                "border px-5 py-2.5 text-[0.66rem] uppercase tracking-[0.18em] transition-colors",
                modulo === undefined
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
              )}
            >
              Todos
            </button>
            {filtros.map((m) => (
              <button
                key={m.key}
                onClick={() => setModulo(m.key)}
                className={cn(
                  "border px-5 py-2.5 text-[0.66rem] uppercase tracking-[0.18em] transition-colors",
                  modulo === m.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                )}
              >
                {m.name}
              </button>
            ))}
          </div>

          <div className="mt-10">
            <Schedule key={modulo ?? "all"} moduleKey={modulo} defaultRange="hoy" />
          </div>

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

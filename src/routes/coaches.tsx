import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { ArrowMark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/coaches")({
  head: () => ({
    meta: [
      { title: "Coaches — Läätu Wellness" },
      {
        name: "description",
        content:
          "Las instructoras que acompañan tu proceso en Läätu: reformer, movilidad y recuperación.",
      },
      { property: "og:title", content: "Coaches — Läätu Wellness" },
      {
        property: "og:description",
        content: "Conoce al equipo que acompaña tu recorrido en Läätu Wellness.",
      },
    ],
  }),
  component: Coaches,
});

function Coaches() {
  const { data } = useQuery({
    queryKey: ["coaches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coaches")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Coaches"
        title="Alguien que mira tu proceso."
        intro="Nombres provisionales mientras se confirma el equipo definitivo y sus horarios."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {(data ?? []).map((c) => (
              <article key={c.id} className="bg-background p-8">
                <div className="constellation grain flex aspect-[3/4] items-center justify-center bg-muted">
                  {c.image_url ? (
                    <img
                      src={c.image_url}
                      alt={c.name}
                      loading="lazy"
                      className="h-full w-full object-cover grayscale"
                    />
                  ) : (
                    <ArrowMark className="h-8 w-8 text-secondary" />
                  )}
                </div>
                <h2 className="mt-6 text-lg">{c.name}</h2>
                <p className="eyebrow mt-1">{c.specialty}</p>
                <p className="mt-3 text-sm text-muted-foreground">{c.bio}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

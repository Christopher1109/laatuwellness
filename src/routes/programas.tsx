import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { BirdMark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import sauna from "@/assets/contrast-sauna.jpg";

export const Route = createFileRoute("/programas")({
  head: () => ({
    meta: [
      { title: "Programas y paquetes — Läätu Wellness" },
      {
        name: "description",
        content:
          "Reformer Studio, terapia de contraste, nutrición y psicología. Conoce los salones, servicios y paquetes de tokens de Läätu.",
      },
      { property: "og:title", content: "Programas y paquetes — Läätu Wellness" },
      {
        property: "og:description",
        content: "Salones, servicios de recuperación y paquetes de clases.",
      },
    ],
  }),
  component: Programas,
});

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function Programas() {
  const { data: modules } = useQuery({
    queryKey: ["modules", "all-enabled"],
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

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_plans")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const salones = (modules ?? []).filter((m) => m.category === "salon");
  const servicios = (modules ?? []).filter((m) => m.category !== "salon");

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Programas"
        title="Traza tu propio camino."
        intro="Cada salón y cada servicio es un módulo independiente. Se activan y se desactivan según lo que el estudio esté ofreciendo hoy."
      />

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Salones</p>
          <div className="mt-10 grid gap-px bg-border md:grid-cols-2">
            {salones.map((m) => (
              <article key={m.key} className="bg-background p-8 sm:p-12">
                <BirdMark className="h-6 w-6 text-secondary" />
                <h2 className="mt-6 text-2xl">{m.name}</h2>
                <p className="mt-4 text-muted-foreground">{m.description}</p>
                <p className="mt-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Máx. 10 personas · 50 min
                </p>
              </article>
            ))}
            {salones.length === 0 ? (
              <p className="bg-background p-8 text-muted-foreground">
                Los salones se anunciarán pronto.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-0 md:grid-cols-2">
          <img
            src={sauna}
            alt="Sauna infrarrojo del área de recuperación"
            loading="lazy"
            width={1408}
            height={1008}
            className="h-full w-full object-cover"
          />
          <div className="px-5 py-20 sm:px-12">
            <p className="eyebrow">Servicios adicionales</p>
            <ul className="mt-8 divide-y divide-border">
              {servicios.map((m) => (
                <li key={m.key} className="py-6">
                  <h3 className="text-lg">{m.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="surface-dark constellation grain">
        <div className="relative z-[2] mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Paquetes</p>
          <h2 className="statement mt-6 text-[clamp(2rem,5vw,3.2rem)]">
            Compra tokens, reserva cuando puedas.
          </h2>
          <p className="mt-5 max-w-lg text-muted-foreground">
            Un token equivale a una clase. Se acreditan a tu cuenta al comprar y
            se descuentan al reservar.
          </p>

          <div className="mt-12 grid gap-px bg-border sm:grid-cols-3">
            {(plans ?? []).map((p) => (
              <article key={p.id} className="surface-dark p-8">
                <h3 className="text-xl">{p.name}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{p.description}</p>
                <p className="mt-8 text-3xl">{money(p.price_cents, p.currency)}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {p.tokens} {p.tokens === 1 ? "token" : "tokens"}
                  {p.recurring ? " · recurrente" : ""}
                  {p.validity_days ? ` · ${p.validity_days} días` : ""}
                </p>
              </article>
            ))}
          </div>

          <Link
            to="/cuenta"
            className="mt-12 inline-block bg-ivory px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-shadow"
          >
            Comprar tokens
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            Precios y reglas de congelamiento pendientes de confirmación con el
            estudio.
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

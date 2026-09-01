import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site-chrome";
import { Constellation, Coordinates } from "@/components/brand";
import { Schedule } from "@/components/schedule";
import { whatsappHref } from "@/components/whatsapp-button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlanCheckoutModal, type CheckoutPlan } from "@/components/payments/plan-checkout-modal";
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
  head: ({ params }) => {
    const title = `Programa ${params.key} — Läätu Wellness`;
    return {
      meta: [
        { title },
        {
          name: "description",
          content:
            "Consulta horarios, cupos y paquetes de sesiones de este programa de Läätu Wellness y reserva en línea.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:title", content: title },
        {
          property: "og:description",
          content: "Horarios en vivo, cupos disponibles y compra de sesiones en Läätu Wellness.",
        },
      ],
    };
  },
  component: ProgramaDetalle,
});

function ProgramaDetalle() {
  const { key } = Route.useParams();
  const [buying, setBuying] = useState<CheckoutPlan | null>(null);
  const { user } = useAuth();

  const { data: modulo, isLoading } = useQuery({
    queryKey: ["site-module", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_modules")
        .select("*")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["token-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_plans")
        .select("*")
        .eq("active", true)
        .order("tokens");
      if (error) throw error;
      return data;
    },
  });


  if (isLoading) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-6xl px-5 py-32 sm:px-8">
          <p className="text-muted-foreground">Cargando programa…</p>
        </div>
      </SiteLayout>
    );
  }

  if (!modulo) return null;

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

      <section id="horarios" className="border-b border-border scroll-mt-28">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Horarios</p>
          <h2 className="statement mt-4 text-[clamp(1.7rem,4vw,2.6rem)]">Cupos en vivo.</h2>
          <div className="mt-12">
            <Schedule moduleKey={modulo.key} defaultRange="semana" />
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Sesiones</p>
          <h2 className="statement mt-4 text-[clamp(1.7rem,4vw,2.6rem)]">Compra tus accesos.</h2>
          <p className="mt-5 max-w-lg text-muted-foreground">
            Los tokens sirven para cualquier programa. Reserva con ellos y cancela hasta 12 horas
            antes sin perderlos.
          </p>

          <div className="mt-12 grid gap-px bg-border sm:grid-cols-3">
            {(plans ?? []).map((p) => (
              <div key={p.id} className="bg-background p-8">
                <h3 className="text-lg">{p.name}</h3>
                <p className="mt-3 text-3xl tabular-nums">
                  ${(p.price_cents / 100).toLocaleString("es-MX")}
                </p>
                <p className="mt-1 text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                  {p.tokens} {p.tokens === 1 ? "token" : "tokens"}
                </p>
                {user ? (
                  <button
                    onClick={() => setBuying(p as unknown as CheckoutPlan)}
                    className="mt-7 w-full border border-foreground py-3 text-[0.68rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
                  >
                    Comprar
                  </button>
                ) : (
                  <Link
                    to="/auth"
                    className="mt-7 block w-full border border-foreground py-3 text-center text-[0.68rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
                  >
                    Entrar para comprar
                  </Link>
                )}
              </div>
            ))}
          </div>

          <Constellation className="mt-20 opacity-50" />
        </div>
      </section>
          {buying ? (
        <PlanCheckoutModal plan={buying} user={user} onClose={() => setBuying(null)} />
      ) : null}
    </SiteLayout>
  );
}

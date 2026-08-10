import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site-chrome";
import { Constellation, BirdMark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import hero from "@/assets/hero-reformer.jpg";
import studio from "@/assets/studio-space.jpg";
import hands from "@/assets/detail-hands.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Läätu Wellness — Wellness Recovery Bar" },
      {
        name: "description",
        content:
          "Estudio boutique de Pilates Reformer y recuperación en salones íntimos de 10 personas. Abraza tu recorrido.",
      },
      { property: "og:title", content: "Läätu Wellness — Wellness Recovery Bar" },
      {
        property: "og:description",
        content:
          "Pilates Reformer, terapia de contraste y bienestar integral. Un espacio para respirar.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const { data: modules } = useQuery({
    queryKey: ["modules", "enabled"],
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

  return (
    <SiteLayout>
      {/* HERO */}
      <section className="relative grain min-h-[86vh] overflow-hidden">
        <img
          src={hero}
          alt="Práctica de Pilates Reformer en el estudio Läätu"
          width={1600}
          height={1104}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[oklch(0.2831_0.0293_281.56_/_0.62)]" />
        <div className="surface-dark relative z-[2] mx-auto flex min-h-[86vh] max-w-6xl flex-col justify-end bg-transparent px-5 pb-16 pt-28 sm:px-8">
          <p className="eyebrow rise">Wellness Recovery Bar</p>
          <h1 className="statement rise mt-6 max-w-3xl text-[clamp(3rem,9vw,6.5rem)]">
            Abraza tu recorrido.
          </h1>
          <p className="rise mt-6 max-w-md text-base text-muted-foreground">
            Pilates Reformer, recuperación por contraste y bienestar integral en
            salones íntimos. El proceso importa más que el destino.
          </p>
          <div className="rise mt-10 flex flex-wrap gap-3">
            <Link
              to="/horarios"
              className="bg-ivory px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-shadow transition-opacity hover:opacity-85"
            >
              Reserva tu clase
            </Link>
            <Link
              to="/programas"
              className="border border-current px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] transition-colors hover:bg-ivory hover:text-shadow"
            >
              Conoce los programas
            </Link>
          </div>
        </div>
      </section>

      {/* STATEMENT */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <Constellation className="mb-14 opacity-60" />
          <div className="grid gap-12 md:grid-cols-[1.2fr_1fr] md:items-end">
            <h2 className="statement text-[clamp(2rem,5vw,3.6rem)]">
              Date un espacio para respirar.
            </h2>
            <p className="text-base text-muted-foreground">
              Läätu existe para acompañar tu transformación consciente: el
              camino del punto A al punto B. Trabajamos el cuerpo pensando en
              longevidad, en conexión y en la pausa que te devuelve a ti.
            </p>
          </div>
        </div>
      </section>

      {/* MÓDULOS ACTIVOS */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <p className="eyebrow">Programas</p>
          <div className="mt-10 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {(modules ?? []).map((m) => (
              <article key={m.key} className="bg-background p-8">
                <BirdMark className="h-5 w-5 text-secondary" variant="glide" />
                <h3 className="mt-6 text-xl">{m.name}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{m.description}</p>
              </article>
            ))}
          </div>
          <Link
            to="/programas"
            className="mt-10 inline-block border-b border-foreground pb-1 text-[0.72rem] uppercase tracking-[0.18em]"
          >
            Ver todo
          </Link>
        </div>
      </section>

      {/* IMAGEN + INTIMIDAD */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-0 md:grid-cols-2">
          <div className="grain relative">
            <img
              src={studio}
              alt="Interior del estudio con luz natural"
              loading="lazy"
              width={1600}
              height={1008}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex flex-col justify-center px-5 py-20 sm:px-12">
            <p className="eyebrow">10 personas por salón</p>
            <h2 className="statement mt-6 text-[clamp(1.9rem,4vw,3rem)]">
              Atención personalizada, no una fila de máquinas.
            </h2>
            <p className="mt-6 text-muted-foreground">
              Cada salón recibe máximo diez personas. Suficiente para que la
              instructora te vea, te corrija y te acompañe. Suficiente para que
              nadie te vea a ti.
            </p>
            <Link
              to="/nosotros"
              className="mt-8 inline-block w-fit border-b border-foreground pb-1 text-[0.72rem] uppercase tracking-[0.18em]"
            >
              Conócenos
            </Link>
          </div>
        </div>
      </section>

      {/* CTA OSCURO */}
      <section className="surface-dark constellation grain">
        <div className="relative z-[2] mx-auto grid max-w-6xl gap-12 px-5 py-28 sm:px-8 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="statement text-[clamp(2rem,5vw,3.4rem)]">
              Vive el hoy, no el mañana.
            </h2>
            <p className="mt-6 max-w-md text-muted-foreground">
              Crea tu cuenta, firma tu waiver y reserva con tokens. Todo desde
              un mismo lugar.
            </p>
            <Link
              to="/auth"
              className="mt-9 inline-block bg-ivory px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-shadow transition-opacity hover:opacity-85"
            >
              Crear mi cuenta
            </Link>
          </div>
          <img
            src={hands}
            alt="Detalle de manos sosteniendo las correas del reformer"
            loading="lazy"
            width={1200}
            height={1504}
            className="aspect-[4/5] w-full object-cover"
          />
        </div>
      </section>
    </SiteLayout>
  );
}

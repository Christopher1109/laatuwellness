import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Constellation } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StripeEmbeddedCheckout } from "@/components/payments/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/payments/PaymentTestModeBanner";

export const Route = createFileRoute("/paquetes")({
  head: () => ({
    meta: [
      { title: "Paquetes y membresías — Läätu Wellness" },
      {
        name: "description",
        content:
          "Class Packages, membresías, Align y Contrast: conoce precios, créditos y términos de cada paquete de Läätu Wellness.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Paquetes y membresías — Läätu Wellness" },
      {
        property: "og:description",
        content: "Precios, créditos y términos de cada paquete de Läätu Wellness.",
      },
    ],
  }),
  component: Paquetes,
});

const CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Class Packages",
  membresia: "Membresías",
  consulta: "Align — DorisFisio",
  recuperacion: "Contrast",
};

const CATEGORY_ORDER = ["clases_pilates", "membresia", "consulta", "recuperacion"];

function money(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function Paquetes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [buying, setBuying] = useState<{
    id: string;
    name: string;
    price: number;
    tokens: number;
    priceId: string;
  } | null>(null);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "is_staff_only" no está en los tipos generados
        .from("token_plans" as any)
        .select("*")
        .eq("active", true)
        .eq("is_staff_only", false)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof plans>>();
    for (const p of plans ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!] as const);
  }, [plans]);

  const handleBuyClick = (p: NonNullable<typeof plans>[number]) => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    const priceId = ((p as unknown as { stripe_price_id?: string }).stripe_price_id ?? "").trim();
    setBuying({
      id: p.id,
      name: p.name,
      price: p.price_cents,
      tokens: p.tokens,
      priceId,
    });
  };

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Paquetes"
        title="Elige tu forma de entrenar."
        intro="Class Packages para Reformer y 4mat, membresías con Align y Contrast incluidos, y sesiones individuales de recovery."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          {isLoading ? (
            <p className="text-muted-foreground">Cargando paquetes…</p>
          ) : (
            <div className="space-y-16">
              {grouped.map(([category, items]) => (
                <div key={category}>
                  <p className="eyebrow">{CATEGORY_LABELS[category] ?? category}</p>
                  <div className="mt-6 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((p) => (
                      <article key={p.id} className="flex flex-col bg-background p-8">
                        <h3 className="text-xl">{p.name}</h3>
                        {p.subtitle ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {p.subtitle}
                          </p>
                        ) : null}
                        <p className="mt-3 flex-1 text-sm text-muted-foreground">{p.description}</p>
                        {p.includes ? (
                          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                            {p.includes
                              .split("\n")
                              .filter(Boolean)
                              .map((line, i) => (
                                <li key={i}>· {line}</li>
                              ))}
                          </ul>
                        ) : null}
                        <p className="mt-6 text-2xl">{money(p.price_cents, p.currency)}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {p.tokens} {p.tokens === 1 ? "crédito" : "créditos"}
                          {p.recurring ? " · recurrente" : ""}
                        </p>
                        <button
                          onClick={() => handleBuyClick(p)}
                          className="mt-6 w-full border border-foreground px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] transition-colors hover:bg-foreground hover:text-background"
                        >
                          {user ? "Comprar" : "Inicia sesión para comprar"}
                        </button>
                        {p.terms ? (
                          <p className="mt-4 text-[0.68rem] leading-relaxed text-muted-foreground">
                            {p.terms}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              ))}
              {grouped.length === 0 ? (
                <p className="text-muted-foreground">
                  Aún no hay paquetes publicados. Escríbenos por WhatsApp y te ayudamos directo.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="surface-dark constellation grain">
        <div className="relative z-[2] mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
          <Constellation className="mx-auto mb-8 h-10 opacity-70" />
          <p className="text-sm text-muted-foreground">
            ¿No sabes cuál te conviene? Escríbenos y te ayudamos a elegir según tu meta y tu
            disponibilidad.
          </p>
        </div>
      </section>

      {buying ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10"
          onClick={() => setBuying(null)}
        >
          <div className="w-full max-w-2xl bg-background" onClick={(e) => e.stopPropagation()}>
            <PaymentTestModeBanner />
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <p className="eyebrow">Pago seguro</p>
                <h3 className="mt-2 text-lg">
                  {buying.name} · {money(buying.price)}
                </h3>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {buying.tokens} {buying.tokens === 1 ? "crédito" : "créditos"}
                </p>
              </div>
              <button
                onClick={() => setBuying(null)}
                className="border border-input px-4 py-2 text-[0.66rem] uppercase tracking-[0.16em]"
              >
                Cerrar
              </button>
            </div>
            <div className="p-4 sm:p-6">
              {buying.priceId ? (
                <StripeEmbeddedCheckout
                  priceId={buying.priceId}
                  planId={buying.id}
                  {...(user?.email ? { customerEmail: user.email } : {})}
                  {...(user?.id ? { userId: user.id } : {})}
                  returnUrl={`${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`}
                />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Este paquete todavía no tiene pago en línea configurado. Escríbenos por WhatsApp y
                  lo resolvemos contigo.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </SiteLayout>
  );
}

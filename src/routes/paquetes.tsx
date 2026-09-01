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
        .from("token_plans")
        .select("*")
        .eq("active", true)
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

  const purchase = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc("purchase_plan", {
        _plan_id: planId,
        _payment_method: "pendiente",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Créditos acreditados a tu cuenta.");
      setBuying(null);
      void qc.invalidateQueries({ queryKey: ["balance"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      navigate({ to: "/cuenta" });
    },
    onError: () => toast.error("No pudimos completar la compra."),
  });

  const handleBuyClick = (p: NonNullable<typeof plans>[number]) => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setBuying({ id: p.id, name: p.name, price: p.price_cents, tokens: p.tokens });
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBuying(null)}
        >
          <div
            className="w-full max-w-sm bg-background p-8 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="eyebrow">Pago seguro</p>
            <h3 className="mt-3 text-xl">Estamos integrando tu pago</h3>
            <p className="mt-4 text-sm text-muted-foreground">
              Muy pronto vas a poder pagar <strong>{buying.name}</strong> ({money(buying.price)})
              con tarjeta directo aquí, vía Stripe. Mientras tanto, tu compra queda registrada y tus{" "}
              {buying.tokens} créditos se acreditan de inmediato a tu cuenta.
            </p>
            <div className="mt-7 flex gap-2">
              <button
                onClick={() => setBuying(null)}
                className="flex-1 border border-input px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em]"
              >
                Cancelar
              </button>
              <button
                disabled={purchase.isPending}
                onClick={() => purchase.mutate(buying.id)}
                className="flex-1 bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
              >
                {purchase.isPending ? "Procesando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SiteLayout>
  );
}

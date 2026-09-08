import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { PaymentTestModeBanner } from "@/components/payments/PaymentTestModeBanner";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createMerchCheckoutSession } from "@/utils/payments.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/merch")({
  head: () => ({
    meta: [
      { title: "Merch — Läätu Wellness" },
      {
        name: "description",
        content: "Playeras, botellas y más de Läätu. Compra en línea, recoge en el estudio.",
      },
      { property: "og:title", content: "Merch — Läätu Wellness" },
      {
        property: "og:description",
        content: "Compra Merch de Läätu en línea y recógelo en el estudio.",
      },
    ],
  }),
  component: Merch,
});

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

type Product = {
  id: string;
  name: string;
  price_cents: number;
  stock: number;
  image_url: string | null;
  description: string | null;
};

function MerchEmbeddedCheckout({
  product,
  qty,
  userEmail,
  userId,
}: {
  product: Product;
  qty: number;
  userEmail?: string;
  userId?: string;
}) {
  const fetchClientSecret = async (): Promise<string> => {
    const result = await createMerchCheckoutSession({
      data: {
        productId: product.id,
        productName: product.name,
        priceCents: product.price_cents,
        qty,
        ...(userEmail ? { customerEmail: userEmail } : {}),
        ...(userId ? { userId } : {}),
        returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Stripe no devolvió un client secret");
    return result.clientSecret;
  };

  return (
    <div id="checkout" className="max-h-[55vh] overflow-y-auto">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

function Merch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [buying, setBuying] = useState<{ product: Product; qty: number } | null>(null);
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});

  const { data: products, isLoading } = useQuery({
    queryKey: ["merch-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price_cents, stock, image_url, description")
        .eq("category", "merch")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const handleBuyClick = (p: Product) => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setBuying({ product: p, qty: qtyByProduct[p.id] ?? 1 });
  };

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Merch"
        title="Llévate un poco de Läätu."
        intro="Compra en línea, recoge en el estudio — te avisamos cuando esté listo."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          {isLoading ? (
            <p className="text-muted-foreground">Cargando…</p>
          ) : (products ?? []).length === 0 ? (
            <p className="text-muted-foreground">
              Todavía no hay Merch disponible. Vuelve pronto.
            </p>
          ) : (
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              {(products ?? []).map((p) => {
                const qty = qtyByProduct[p.id] ?? 1;
                const outOfStock = p.stock <= 0;
                return (
                  <div key={p.id} className="flex flex-col bg-background p-6 sm:p-7">
                    <div className="constellation grain flex aspect-square items-center justify-center bg-muted">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <p className="px-4 text-center text-xs text-muted-foreground">
                          Foto próximamente
                        </p>
                      )}
                    </div>
                    <h3 className="mt-5 text-lg">{p.name}</h3>
                    <p className="mt-1 font-mono text-sm text-muted-foreground">
                      {money(p.price_cents)}
                    </p>
                    {p.description ? (
                      <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                    ) : null}
                    {outOfStock ? (
                      <p className="mt-4 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        Agotado
                      </p>
                    ) : (
                      <div className="mt-4 flex items-center gap-3">
                        <select
                          value={qty}
                          onChange={(e) =>
                            setQtyByProduct((prev) => ({
                              ...prev,
                              [p.id]: Number(e.target.value),
                            }))
                          }
                          className="border border-input bg-background px-2 py-2 text-sm"
                        >
                          {Array.from({ length: Math.min(p.stock, 5) }, (_, i) => i + 1).map(
                            (n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ),
                          )}
                        </select>
                        <button
                          onClick={() => handleBuyClick(p)}
                          className="flex-1 bg-foreground px-5 py-2.5 text-[0.68rem] uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-85"
                        >
                          Comprar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
            Se recoge en el estudio · te avisamos cuando esté listo
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
                  {buying.product.name} · {buying.qty}× ·{" "}
                  {money(buying.product.price_cents * buying.qty)}
                </h3>
              </div>
              <button
                onClick={() => setBuying(null)}
                className="border border-input px-4 py-2 text-[0.66rem] uppercase tracking-[0.16em]"
              >
                Cerrar
              </button>
            </div>
            <div className="p-4 sm:p-6">
              <MerchEmbeddedCheckout
                product={buying.product}
                qty={buying.qty}
                {...(user?.email ? { userEmail: user.email } : {})}
                {...(user?.id ? { userId: user.id } : {})}
              />
            </div>
          </div>
        </div>
      ) : null}
    </SiteLayout>
  );
}

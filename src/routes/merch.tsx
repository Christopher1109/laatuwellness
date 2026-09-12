import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createMerchClipCheckout } from "@/utils/clip.functions";

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

function Merch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [paying, setPaying] = useState<string | null>(null);
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});

  const { data: products, isLoading } = useQuery({
    queryKey: ["merch-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price_cents, stock, image_url, description, brand")
        .eq("category", "merch")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      const filtered = (data ?? []).filter(
        (p) => (p as unknown as { brand?: string }).brand !== "goodes",
      );
      return filtered as unknown as Product[];
    },
  });

  const handleBuy = async (product: Product, qty: number) => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setPaying(product.id);
    try {
      const result = await createMerchClipCheckout({
        data: {
          productId: product.id,
          productName: product.name,
          priceCents: product.price_cents,
          qty,
          origin: window.location.origin,
        },
      });
      if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
      } else {
        throw new Error("Clip no devolvió un link de pago.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el pago.");
      setPaying(null);
    }
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
                const busy = paying === p.id;
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
                          onClick={() => handleBuy(p, qty)}
                          disabled={busy}
                          className="flex-1 bg-foreground px-5 py-2.5 text-[0.68rem] uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
                        >
                          {busy ? "Preparando…" : "Comprar"}
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
    </SiteLayout>
  );
}

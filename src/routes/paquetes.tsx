import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Constellation } from "@/components/brand";
import { useAuth } from "@/hooks/useAuth";
import { PlanCheckoutModal, type CheckoutPlan } from "@/components/payments/plan-checkout-modal";
import { PlanCatalog, type CatalogPlan } from "@/components/plan-catalog";

export const Route = createFileRoute("/paquetes")({
  head: () => ({
    links: [{ rel: "canonical", href: "https://laatuwellness.com/paquetes" }],
    meta: [
      { property: "og:url", content: "https://laatuwellness.com/paquetes" },
      { title: "Precios, paquetes y membresías de Pilates — Läätu Wellness San Pedro" },
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

function Paquetes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [buying, setBuying] = useState<CheckoutPlan | null>(null);

  const handleBuyClick = (p: CatalogPlan) => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setBuying(p as unknown as CheckoutPlan);
  };

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Paquetes"
        title="Elige tu forma de entrenar."
        intro="Paquetes de clases, membresías y recuperación."
      />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <PlanCatalog variant="page" onBuy={handleBuyClick} />
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
        <PlanCheckoutModal plan={buying} user={user} onClose={() => setBuying(null)} />
      ) : null}
    </SiteLayout>
  );
}

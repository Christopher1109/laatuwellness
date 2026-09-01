import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SiteLayout, PageHeader } from "@/components/site-chrome";

export const Route = createFileRoute("/checkout/return")({
  head: () => ({
    meta: [
      { title: "Pago confirmado — Läätu Wellness" },
      {
        name: "description",
        content:
          "Confirmación de tu compra en Läätu Wellness: tus créditos se acreditan a tu cuenta para reservar clases.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Pago confirmado — Läätu Wellness" },
      {
        property: "og:description",
        content: "Tus créditos ya están en tu cuenta de Läätu Wellness.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search["session_id"] === "string"
      ? { session_id: search["session_id"] as string }
      : {},
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id: sessionId } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["balance"] });
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    const t = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["balance"] });
    }, 4000);
    return () => clearTimeout(t);
  }, [qc]);

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Pago"
        title={sessionId ? "Gracias por tu compra." : "No encontramos tu pago."}
        intro={
          sessionId
            ? "Estamos acreditando tus créditos. En unos segundos aparecerán en tu cuenta."
            : "Si crees que hubo un error, escríbenos por WhatsApp y lo revisamos contigo."
        }
      />
      <section>
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate({ to: "/cuenta" })}
              className="bg-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85"
            >
              Ir a mi cuenta
            </button>
            <Link
              to="/paquetes"
              className="border border-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
            >
              Ver paquetes
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

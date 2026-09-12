import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { useAuth } from "@/hooks/useAuth";
import { getClipOrderStatus } from "@/utils/clip.functions";

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
  validateSearch: (search: Record<string, unknown>): { clip_order_id?: string; error?: boolean } => {
    const clip_order_id =
      typeof search["clip_order_id"] === "string" ? (search["clip_order_id"] as string) : undefined;
    const error = search["error"] === "1" || search["error"] === 1;
    return clip_order_id === undefined ? { error } : { clip_order_id, error };
  },
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const search = Route.useSearch();
  const orderId = search.clip_order_id;
  const hasError = search.error;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const fetchStatus = useServerFn(getClipOrderStatus);

  const { data: status, isLoading } = useQuery({
    queryKey: ["clip-order-status", orderId, user?.id],
    enabled: Boolean(orderId) && Boolean(user),
    queryFn: () => fetchStatus({ data: { orderId: orderId! } }),
    refetchInterval: (query) => {
      const s = query.state.data;
      if (!s || s.fulfilled) return false;
      return 4000;
    },
  });

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["balance"] });
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    const t = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["balance"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    }, 4000);
    return () => clearTimeout(t);
  }, [qc]);

  let title = "No encontramos tu pago.";
  let intro = "Si crees que hubo un error, escríbenos por WhatsApp y lo revisamos contigo.";

  if (hasError) {
    title = "El pago no se completó.";
    intro = "Puedes intentar de nuevo. Si el cargo ya apareció en tu cuenta, espera unos minutos.";
  } else if (!orderId) {
    title = "No encontramos tu pago.";
    intro = "El link de regreso no trae número de orden. Escríbenos si necesitas ayuda.";
  } else if (isLoading) {
    title = "Estamos confirmando tu pago…";
    intro = "Esto solo tarda unos segundos.";
  } else if (status?.fulfilled) {
    title = "Gracias por tu compra.";
    intro = "Tus créditos ya fueron acreditados a tu cuenta.";
  } else if (status?.status === "pending" || status?.status === "created") {
    title = "Estamos esperando la confirmación.";
    intro = "En cuanto Clip confirme tu pago, acreditaremos tus créditos.";
  } else if (status?.status === "canceled" || status?.status === "expired") {
    title = "El pago fue cancelado o expiró.";
    intro = "Si quieres, vuelve a intentarlo.";
  } else if (status) {
    title = "Estado del pago: " + status.status;
    intro = "Estamos procesando tu orden.";
  }

  return (
    <SiteLayout>
      <PageHeader eyebrow="Pago" title={title} intro={intro} />
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

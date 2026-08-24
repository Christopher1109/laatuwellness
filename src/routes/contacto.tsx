import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/contacto")({
  head: () => ({
    meta: [
      { title: "Contacto — Läätu Wellness" },
      {
        name: "description",
        content:
          "Escríbenos para conocer el estudio, agendar una visita o resolver dudas sobre paquetes y horarios.",
      },
      { property: "og:title", content: "Contacto — Läätu Wellness" },
      {
        property: "og:description",
        content: "Agenda una visita al estudio o pregúntanos por los paquetes.",
      },
    ],
  }),
  component: Contacto,
});

const schema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre").max(100),
  email: z.string().trim().email("Correo inválido").max(255),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  message: z.string().trim().min(5, "Cuéntanos un poco más").max(1000),
});

function Contacto() {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      phone: form.get("phone"),
      message: form.get("message"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Revisa los datos");
      return;
    }
    setSending(true);
    const { error } = await supabase.from("leads").insert({
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      message: parsed.data.message,
    });
    setSending(false);
    if (error) {
      toast.error("No pudimos enviar tu mensaje. Intenta de nuevo.");
      return;
    }
    setSent(true);
    toast.success("Gracias. Te escribimos pronto.");
  };

  const field =
    "mt-2 w-full border border-input bg-transparent px-4 py-3 text-sm outline-none transition-colors focus:border-foreground";

  return (
    <SiteLayout>
      <PageHeader
        eyebrow="Contacto"
        title="Agradece el recorrido."
        intro="Cuéntanos dónde estás hoy y qué buscas. Te respondemos con lo que necesitas saber para empezar."
      />

      <section>
        <div className="mx-auto grid max-w-6xl gap-16 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="eyebrow">Directo</p>
            <ul className="mt-6 space-y-3 text-sm">
              <li>
                <a href="mailto:lore@tuwellness.com" className="border-b border-foreground pb-0.5">
                  lore@tuwellness.com
                </a>
              </li>
              <li>
                <a
                  href="https://instagram.com/laatu"
                  target="_blank"
                  rel="noreferrer"
                  className="border-b border-foreground pb-0.5"
                >
                  Instagram @laatu
                </a>
              </li>
            </ul>
            <p className="mt-10 text-sm text-muted-foreground">
              Dirección y teléfono del estudio pendientes de confirmación.
            </p>
          </div>

          {sent ? (
            <div className="border border-border p-10">
              <h2 className="text-2xl">Recibido.</h2>
              <p className="mt-3 text-muted-foreground">
                Date un espacio para respirar. Te contactamos en breve.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="eyebrow">
                  Nombre
                </label>
                <input id="name" name="name" required maxLength={100} className={field} />
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="email" className="eyebrow">
                    Correo
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    maxLength={255}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="eyebrow">
                    Teléfono (opcional)
                  </label>
                  <input id="phone" name="phone" maxLength={30} className={field} />
                </div>
              </div>
              <div>
                <label htmlFor="message" className="eyebrow">
                  Mensaje
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  required
                  maxLength={1000}
                  className={field}
                />
              </div>
              <button
                type="submit"
                disabled={sending}
                className="bg-foreground px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </form>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}

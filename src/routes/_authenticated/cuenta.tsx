import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SiteLayout } from "@/components/site-chrome";
import { SignaturePad } from "@/components/signature-pad";
import { Constellation } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/cuenta")({
  head: () => ({
    meta: [
      { title: "Mi cuenta — Läätu Wellness" },
      {
        name: "description",
        content:
          "Consulta tu saldo de tokens, tus reservas, tus compras y firma tu waiver digital.",
      },
      { property: "og:title", content: "Mi cuenta — Läätu Wellness" },
      { property: "og:description", content: "Tokens, reservas y waiver de Läätu Wellness." },
    ],
  }),
  component: Cuenta,
});

function money(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dateTime(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function Cuenta() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [signature, setSignature] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(user),
  });

  const balance = useQuery({
    queryKey: ["balance", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("token_balance", {
        _user_id: user!.id,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    enabled: Boolean(user),
  });

  const waiver = useQuery({
    queryKey: ["waiver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_signatures")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(user),
  });

  const plans = useQuery({
    queryKey: ["plans"],
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

  const bookings = useQuery({
    queryKey: ["bookings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, classes(room, instructor, starts_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(user),
  });

  const transactions = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, token_plans(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(user),
  });

  const signWaiver = useMutation({
    mutationFn: async () => {
      if (!signature) throw new Error("Necesitamos tu firma.");
      const { error } = await supabase.from("waiver_signatures").insert({
        user_id: user!.id,
        signature_data: signature,
        full_name: profile.data?.full_name ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Waiver firmado. Ya puedes reservar.");
      void qc.invalidateQueries({ queryKey: ["waiver"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purchase = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc("purchase_plan", {
        _plan_id: planId,
        _payment_method: "pendiente",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tokens acreditados a tu cuenta.");
      void qc.invalidateQueries({ queryKey: ["balance"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: () => toast.error("No pudimos completar la compra."),
  });

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("cancel_booking", {
        _booking_id: bookingId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reserva cancelada.");
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: () => toast.error("No pudimos cancelar la reserva."),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("leave_waitlist", { _booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saliste de la lista de espera. Tu crédito fue devuelto.");
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: () => toast.error("No se pudo salir de la lista de espera."),
  });

  const now = Date.now();
  const upcoming = (bookings.data ?? []).filter(
    (b) => b.status === "reservada" && new Date(b.classes!.starts_at).getTime() > now,
  );
  const waitlisted = (bookings.data ?? []).filter(
    (b) => b.status === "lista_espera" && new Date(b.classes!.starts_at).getTime() > now,
  );
  const past = (bookings.data ?? []).filter(
    (b) =>
      (b.status !== "reservada" && b.status !== "lista_espera") ||
      new Date(b.classes!.starts_at).getTime() <= now,
  );

  return (
    <SiteLayout>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <p className="eyebrow">Mi cuenta</p>
          <h1 className="statement mt-4 text-[clamp(2rem,5vw,3.4rem)]">
            {profile.data?.full_name || "Tu recorrido"}
          </h1>
          <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-3">
            <div className="bg-background p-6">
              <p className="eyebrow">Tokens disponibles</p>
              <p className="mt-3 text-4xl">{balance.data ?? 0}</p>
            </div>
            <div className="bg-background p-6">
              <p className="eyebrow">Waiver</p>
              <p className="mt-3 text-lg">{waiver.data ? "Firmado" : "Pendiente"}</p>
            </div>
            <div className="bg-background p-6">
              <p className="eyebrow">Próximas clases</p>
              <p className="mt-3 text-4xl">{upcoming.length}</p>
            </div>
          </div>
        </div>
      </section>

      {!waiver.data ? (
        <section className="border-b border-border">
          <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
            <p className="eyebrow">Waiver digital</p>
            <h2 className="statement mt-4 text-2xl">Firma antes de tu primera clase</h2>
            <div className="mt-6 max-h-52 overflow-y-auto border border-border p-5 text-sm text-muted-foreground">
              {/* TODO: reemplazar por el texto legal definitivo del waiver. */}
              <p>
                Declaro que participo de forma voluntaria en las actividades físicas ofrecidas por
                Läätu Wellness y que me encuentro en condiciones de salud adecuadas para
                realizarlas. Informaré al estudio sobre cualquier lesión, embarazo o condición
                médica relevante antes de cada sesión.
              </p>
              <p className="mt-3">
                Entiendo que toda actividad física implica riesgos y libero a Läätu Wellness, a su
                personal e instructoras de responsabilidad por lesiones derivadas de mi
                participación, salvo negligencia comprobada. Acepto seguir las indicaciones de las
                instructoras y las políticas de reservas, cancelaciones y uso de tokens.
              </p>
              <p className="mt-3 italic">
                Texto legal preliminar, pendiente de revisión por el estudio.
              </p>
            </div>
            <div className="mt-6">
              <SignaturePad onChange={setSignature} />
            </div>
            <button
              onClick={() => signWaiver.mutate()}
              disabled={!signature || signWaiver.isPending}
              className="mt-6 bg-foreground px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-background disabled:opacity-40"
            >
              Firmar waiver
            </button>
          </div>
        </section>
      ) : null}

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <p className="eyebrow">Comprar tokens</p>
          <div className="mt-8 grid gap-px bg-border sm:grid-cols-3">
            {(plans.data ?? []).map((p) => (
              <article key={p.id} className="bg-background p-8">
                <h3 className="text-xl">{p.name}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{p.description}</p>
                <p className="mt-6 text-2xl">{money(p.price_cents, p.currency)}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {p.tokens} tokens{p.recurring ? " · recurrente" : ""}
                </p>
                <button
                  onClick={() => purchase.mutate(p.id)}
                  disabled={purchase.isPending}
                  className="mt-6 w-full border border-foreground px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] transition-colors hover:bg-foreground hover:text-background disabled:opacity-40"
                >
                  Comprar
                </button>
              </article>
            ))}
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            El cobro con tarjeta y la suscripción recurrente se activan al conectar la pasarela de
            pago. Por ahora la compra queda registrada y los tokens se acreditan de inmediato.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <p className="eyebrow">Próximas reservas</p>
          {upcoming.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No tienes clases próximas.{" "}
              <Link to="/horarios" className="border-b border-foreground pb-0.5 text-foreground">
                Ver horarios
              </Link>
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-border border-y border-border">
              {upcoming.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div>
                    <p>
                      {dateTime(b.classes!.starts_at)}
                      {b.seat_number ? (
                        <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[0.6rem] text-background">
                          {b.seat_number}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {b.classes!.room} · {b.classes!.instructor}
                    </p>
                  </div>
                  <button
                    onClick={() => cancel.mutate(b.id)}
                    className="border border-input px-5 py-2 text-[0.7rem] uppercase tracking-[0.16em] hover:border-foreground"
                  >
                    Cancelar
                  </button>
                </li>
              ))}
            </ul>
          )}

          {waitlisted.length > 0 ? (
            <div className="mt-12">
              <p className="eyebrow">Lista de espera</p>
              <ul className="mt-6 divide-y divide-border border-y border-border">
                {waitlisted.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
                    <div>
                      <p>{dateTime(b.classes!.starts_at)}</p>
                      <p className="text-sm text-muted-foreground">
                        {b.classes!.room} · {b.classes!.instructor}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-amber-600">
                        Tu crédito está apartado — se devuelve si no hay lugar
                      </p>
                    </div>
                    <button
                      onClick={() => leaveWaitlist.mutate(b.id)}
                      className="border border-input px-5 py-2 text-[0.7rem] uppercase tracking-[0.16em] hover:border-foreground"
                    >
                      Salir de la lista
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <Constellation className="mb-12 opacity-50" />
          <div className="grid gap-14 md:grid-cols-2">
            <div>
              <p className="eyebrow">Historial de clases</p>
              <ul className="mt-6 divide-y divide-border border-y border-border text-sm">
                {past.length === 0 ? (
                  <li className="py-5 text-muted-foreground">Aún sin historial.</li>
                ) : (
                  past.map((b) => (
                    <li key={b.id} className="flex justify-between gap-4 py-4">
                      <span>{dateTime(b.classes!.starts_at)}</span>
                      <span className="text-muted-foreground">{b.status}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <p className="eyebrow">Compras</p>
              <ul className="mt-6 divide-y divide-border border-y border-border text-sm">
                {(transactions.data ?? []).length === 0 ? (
                  <li className="py-5 text-muted-foreground">Sin compras registradas.</li>
                ) : (
                  (transactions.data ?? []).map((t) => (
                    <li key={t.id} className="flex justify-between gap-4 py-4">
                      <span>{t.token_plans?.name ?? "Paquete"}</span>
                      <span className="text-muted-foreground">
                        {money(t.amount_cents, t.currency)} · {t.tokens} tokens
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

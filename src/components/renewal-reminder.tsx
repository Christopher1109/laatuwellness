import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CardSetupCheckout } from "@/components/payment-method-card";
import { PlanCheckoutModal, type CheckoutPlan } from "@/components/payments/plan-checkout-modal";
import { paymentsConfigured } from "@/lib/stripe";

type PlanOption = { id: string | null; name: string | null; price_cents: number | null };

export type RenewalStatus = {
  plan_name: string;
  ends_at: string;
  days_left: number;
  has_card: boolean;
  auto_renew: boolean;
  card_brand: string;
  card_last4: string;
  renewal_plan_name: string | null;
  opted_out: boolean;
  is_founders: boolean;
  founders_options: { monthly: PlanOption; semestral: PlanOption; everyday: PlanOption } | null;
  show_founders_modal: boolean;
  show_modal: boolean;
};

export function useRenewalStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ["renewal-status", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("renewal_status", { _user_id: userId! });
      if (error) throw error;
      return (data as unknown as RenewalStatus | null) ?? null;
    },
  });
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Monterrey" }).format(
    new Date(iso),
  );

const money = (cents: number | null) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);

function Overlay({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="w-full max-w-lg border border-border bg-background p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function useOptOut(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("opt_out_renewal");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entendido: tu membresía terminará en su fecha de vencimiento.");
      void qc.invalidateQueries({ queryKey: ["renewal-status", userId] });
    },
    onError: () => toast.error("No se pudo guardar tu decisión."),
  });
}

const MONTHLY_CONSENT = (price: string) =>
  `Acepto el cargo automático de ${price} a mi tarjeta el día 2 de cada mes para renovar mi Founders Access (puedo desactivarlo desde mi perfil), y la política de cancelación: puedo cancelar sin costo hasta 12 h antes de la clase; a la 3ª falta se cobra una multa de $150 a esta tarjeta.`;

/** Mensaje de Founders con sus 3 opciones de renovación. */
export function FoundersRenewalOptions({
  status,
  userId,
  user,
  onClose,
}: {
  status: RenewalStatus;
  userId: string | undefined;
  user?: { id?: string; email?: string } | null | undefined;
  onClose: () => void;
}) {
  const opts = status.founders_options;
  const [step, setStep] = useState<"options" | "monthly">("options");
  const [consent, setConsent] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [buying, setBuying] = useState<CheckoutPlan | null>(null);
  const optOut = useOptOut(userId);
  if (!opts) return null;

  const buy = (p: PlanOption) => {
    if (!p.id) return;
    // Pago único (Clip): la opción 03 es sin recurrencia aunque el plan exista
    // como suscripción en Stripe.
    setBuying({ id: p.id, name: p.name ?? "", price_cents: p.price_cents ?? 0, tokens: 0, recurring: false });
  };

  if (buying) {
    return <PlanCheckoutModal plan={buying} user={user ?? null} onClose={() => setBuying(null)} />;
  }

  return (
    <Overlay label="Renovación Founders Access">
      <p className="eyebrow">LAATU WELLNESS | FOUNDERS ACCESS 🩵</p>
      {step === "options" ? (
        <>
          <h3 className="statement mt-2 text-2xl">¡Hola! ✨</h3>
          <p className="mt-3 text-sm text-muted-foreground">
            Tu Founders Access termina el {fmtDate(status.ends_at)}. Si deseas continuar disfrutando
            de tu membresía, con acceso a 1 clase diaria, tenemos las siguientes opciones:
          </p>
          <div className="mt-5 space-y-3">
            <button
              onClick={() => setStep("monthly")}
              disabled={!paymentsConfigured() || !opts.monthly.id}
              className="block w-full border border-input p-4 text-left hover:border-foreground disabled:opacity-50"
            >
              <span className="block text-sm font-medium">
                01 | Membresía recurrente — {money(opts.monthly.price_cents)}/mes
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Conserva tu precio especial de Founders con un cargo automático el día 2 de cada mes.
              </span>
            </button>
            <button
              onClick={() => buy(opts.semestral)}
              disabled={!opts.semestral.id}
              className="block w-full border border-input p-4 text-left hover:border-foreground disabled:opacity-50"
            >
              <span className="block text-sm font-medium">
                02 | Pago anticipado de 6 meses — {money(opts.semestral.price_cents)}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Equivalente a $4,000 mensuales, con el beneficio de congelar tu membresía hasta 2
                semanas al año.
              </span>
            </button>
            <button
              onClick={() => buy(opts.everyday)}
              disabled={!opts.everyday.id}
              className="block w-full border border-input p-4 text-left hover:border-foreground disabled:opacity-50"
            >
              <span className="block text-sm font-medium">
                03 | Membresía mensual sin recurrencia — {money(opts.everyday.price_cents)}/mes
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Sin cargos automáticos, a precio regular. Págala aquí o en recepción con cualquier
                forma de pago.
              </span>
            </button>
          </div>
          <div className="mt-5 bg-foreground p-4 text-background">
            <p className="text-sm font-medium">⭐ IMPORTANTE | Política de cancelación ⭐</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              <li>Puedes cancelar sin costo hasta 12 horas antes de tu clase.</li>
              <li>Cancelar con menos de 12 horas o no asistir cuenta como falta.</li>
              <li>
                A la 3ª falta se cobra una multa de $150. Después vuelves a tener 2 faltas sin cargo,
                y a la siguiente se cobra de nuevo.
              </li>
              <li>Para continuar con tu membresía es necesario registrar una tarjeta en tu cuenta.</li>
            </ul>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Nos encantará que sigas formando parte de nuestra comunidad. 🩵
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={onClose}
              className="flex-1 border border-input px-4 py-3 text-[0.65rem] uppercase tracking-[0.16em] hover:border-foreground"
            >
              Recordarme después
            </button>
            <button
              onClick={() => optOut.mutate(undefined, { onSuccess: onClose })}
              disabled={optOut.isPending}
              className="flex-1 px-4 py-3 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              No quiero renovar
            </button>
          </div>
        </>
      ) : settingUp && opts.monthly.id ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            No se hace ningún cobro al registrarla. El primer cargo de{" "}
            {money(opts.monthly.price_cents)} será al terminar tu periodo actual.
          </p>
          <div className="mt-4">
            <CardSetupCheckout renewalPlanId={opts.monthly.id} />
          </div>
          <button
            onClick={() => setSettingUp(false)}
            className="mt-4 w-full border border-input px-4 py-2 text-[0.65rem] uppercase tracking-[0.16em]"
          >
            Regresar
          </button>
        </>
      ) : (
        <>
          <h3 className="statement mt-2 text-xl">
            Membresía recurrente — {money(opts.monthly.price_cents)}/mes
          </h3>
          <p className="mt-3 text-sm text-muted-foreground">
            Registra tu tarjeta y a partir del {fmtDate(status.ends_at)} se cobrará automáticamente{" "}
            {money(opts.monthly.price_cents)} el día 2 de cada mes.
          </p>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
            />
            {MONTHLY_CONSENT(money(opts.monthly.price_cents))}
          </label>
          <div className="mt-5 space-y-2">
            <button
              onClick={() => setSettingUp(true)}
              disabled={!consent}
              className="w-full bg-foreground px-5 py-3.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-40"
            >
              Registrar tarjeta
            </button>
            <button
              onClick={() => setStep("options")}
              className="w-full border border-input px-5 py-3 text-[0.65rem] uppercase tracking-[0.16em]"
            >
              Ver otras opciones
            </button>
          </div>
        </>
      )}
    </Overlay>
  );
}

/** Botón "Renovar" para Founders (Mi cuenta / app) que abre las 3 opciones. */
export function FoundersRenewButton({
  userId,
  user,
}: {
  userId: string | undefined;
  user?: { id?: string; email?: string } | null | undefined;
}) {
  const { data } = useRenewalStatus(userId);
  const [open, setOpen] = useState(false);
  if (!data?.is_founders || data.days_left > 15 || data.renewal_plan_name) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background"
      >
        Renovar
      </button>
      {open ? (
        <FoundersRenewalOptions status={data} userId={userId} user={user} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** Pop-up automático al entrar: Founders (3 opciones, 15 días antes) o
 *  genérico para las demás membresías sin cargo automático (10 días antes). */
export function RenewalReminder({
  userId,
  user,
}: {
  userId: string | undefined;
  user?: { id?: string; email?: string } | null | undefined;
}) {
  const { data } = useRenewalStatus(userId);
  const [dismissed, setDismissed] = useState(false);
  const optOut = useOptOut(userId);

  if (!data || dismissed) return null;

  if (data.show_founders_modal) {
    return (
      <FoundersRenewalOptions
        status={data}
        userId={userId}
        user={user}
        onClose={() => setDismissed(true)}
      />
    );
  }

  if (!data.show_modal) return null;

  return (
    <Overlay label="Renovación de membresía">
      <p className="eyebrow">LAATU WELLNESS 🩵</p>
      <h3 className="statement mt-2 text-2xl">Tu membresía termina el {fmtDate(data.ends_at)}</h3>
      <p className="mt-3 text-sm text-muted-foreground">
        Si deseas seguir disfrutando de tus clases y de todos los beneficios de tu membresía{" "}
        {data.plan_name}, renuévala fácilmente aquí. Nos encantará que sigas formando parte de
        nuestra comunidad. 🩵
      </p>
      <div className="mt-6 space-y-2">
        <a
          href="/paquetes"
          className="block w-full bg-foreground px-5 py-3.5 text-center text-[0.7rem] uppercase tracking-[0.16em] text-background"
        >
          Renovar
        </a>
        <button
          onClick={() => optOut.mutate()}
          disabled={optOut.isPending}
          className="w-full border border-input px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] hover:border-foreground disabled:opacity-50"
        >
          No quiero renovar
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="w-full px-5 py-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          Recordarme después
        </button>
      </div>
    </Overlay>
  );
}

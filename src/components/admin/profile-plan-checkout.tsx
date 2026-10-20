import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";
import { collectProfileCash } from "@/utils/profile-checkout.functions";
import { startTerminalPayment, checkTerminalPayment, cancelTerminalPayment, type TerminalPaymentState } from "@/utils/pos-terminal.functions";
import { PROFILE_PAYMENT_METHODS, cashReceivedCents } from "@/lib/profile-checkout";
import { describeError } from "@/lib/describe-error";

const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

export function ProfilePlanCheckout({ clientId, plan, onClose, onPaid }: {
  clientId: string; plan: Tables<"token_plans">; onClose: () => void; onPaid: () => void;
}) {
  const qc = useQueryClient();
  const cashFn = useServerFn(collectProfileCash);
  const startFn = useServerFn(startTerminalPayment);
  const checkFn = useServerFn(checkTerminalPayment);
  const cancelFn = useServerFn(cancelTerminalPayment);
  const [method, setMethod] = useState<typeof PROFILE_PAYMENT_METHODS[number]>("efectivo");
  const [received, setReceived] = useState("");
  const [payment, setPayment] = useState<TerminalPaymentState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const receivedCents = cashReceivedCents(received);
  const cashValid = receivedCents !== null && receivedCents >= plan.price_cents;
  const waiting = payment && ["creating", "pending", "declined"].includes(payment.status);

  const paid = (change?: number) => {
    for (const key of ["client-detail-balance", "client-detail-purchases", "credit-lots", "membership-status", "token-balance"]) {
      void qc.invalidateQueries({ queryKey: [key, clientId] });
    }
    void qc.invalidateQueries({ queryKey: ["pos-recent-sales"] });
    toast.success(change === undefined ? "Pago aprobado. Compra registrada." : `Compra registrada. Cambio: ${money(change)}.`);
    onPaid();
  };

  const checkout = useMutation({
    mutationFn: async () => {
      setMessage(null);
      if (method === "efectivo") {
        if (receivedCents === null) throw new Error("Ingresa el efectivo recibido.");
        return { cash: await cashFn({ data: { clientId, planId: plan.id, receivedCents } }) };
      }
      const state = await startFn({ data: {
        brand: "laatu", clientId, items: [], plans: [{ planId: plan.id, qty: 1 }], origin: window.location.origin,
      } });
      setPayment(state);
      return { cash: null };
    },
    onSuccess: ({ cash }) => { if (cash) paid(cash.changeCents); },
    onError: (error) => setMessage(describeError(error, "No se pudo cobrar.")),
  });

  useEffect(() => {
    if (!payment?.id || !["pending", "declined"].includes(payment.status)) return;
    let stopped = false;
    let checking = false;
    const tick = async () => {
      if (checking) return;
      checking = true;
      try {
        const state = await checkFn({ data: { paymentId: payment.id } });
        if (!stopped) { setPayment(state); setMessage(null); }
      } catch { if (!stopped) setMessage("No se pudo consultar el pago. Seguimos verificando; no vuelvas a cobrar."); }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => void tick(), 2500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [payment?.id, payment?.status, checkFn]);

  useEffect(() => {
    if (payment?.status === "completed") paid();
    // Only complete once for the approved payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.status]);

  const cancel = async () => {
    if (!payment?.id || canceling) return;
    setCanceling(true);
    try {
      const state = await cancelFn({ data: { paymentId: payment.id } });
      setPayment(state);
      setMessage(state.message ?? null);
    } catch (error) { setMessage(describeError(error, "No se pudo cancelar el cobro.")); }
    finally { setCanceling(false); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !waiting && !checkout.isPending && !canceling) onClose(); }}>
    <DialogContent className="max-w-lg" onInteractOutside={(event) => { if (waiting || checkout.isPending || canceling) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Comprar {plan.name}</DialogTitle></DialogHeader>
      <div className="flex justify-between border-b border-border pb-4 text-lg"><span>Total</span><span>{money(plan.price_cents)}</span></div>
      {!payment ? <>
        <fieldset disabled={checkout.isPending} className="flex gap-6">
          <legend className="mb-3 text-sm">Forma de pago</legend>
          {PROFILE_PAYMENT_METHODS.map((key) => <label key={key} className="flex items-center gap-2 text-sm">
            <input type="radio" name="profile-payment-method" checked={method === key} onChange={() => { setMethod(key); setMessage(null); }} />
            {key === "efectivo" ? "Efectivo" : "Tarjeta · Terminal Clip"}
          </label>)}
        </fieldset>
        {method === "efectivo" ? <div className="space-y-3">
          <label className="block text-sm" htmlFor="profile-cash">Efectivo recibido (MXN)</label>
          <input id="profile-cash" type="number" min="0" step="0.01" inputMode="decimal" value={received} disabled={checkout.isPending} onChange={(event) => setReceived(event.target.value)} className="w-full border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-sm text-muted-foreground">Cambio: {cashValid && receivedCents !== null ? money(receivedCents - plan.price_cents) : "—"}</p>
        </div> : <p className="text-sm text-muted-foreground">Terminal Läätu · {money(plan.price_cents)}</p>}
      </> : <div className="space-y-3">
        <p className="text-sm">{payment.status === "pending" ? "Esperando pago en la terminal Läätu…" : payment.status === "declined" ? "Tarjeta rechazada. Puedes reintentar en la misma terminal o cancelar el cobro." : payment.status === "canceled" ? "Cobro cancelado. No se registró una compra." : payment.status === "completed" ? "Pago aprobado." : payment.error ?? "El pago no se completó."}</p>
      </div>}
      {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
      {plan.terms ? <p className="text-xs text-muted-foreground">{plan.terms}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {waiting ? <Button variant="outline" disabled={canceling} onClick={() => void cancel()}>{canceling ? "Cancelando…" : "Cancelar cobro"}</Button> : <>
          <Button variant="outline" disabled={checkout.isPending || canceling} onClick={onClose}>Cerrar</Button>
          {payment ? <Button onClick={() => { setPayment(null); setMessage(null); }}>Volver al pago</Button> : <Button disabled={checkout.isPending || (method === "efectivo" && !cashValid)} onClick={() => checkout.mutate()}>
            {checkout.isPending ? "Procesando…" : method === "efectivo" ? "Confirmar efectivo" : "Cobrar en terminal"}
          </Button>}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
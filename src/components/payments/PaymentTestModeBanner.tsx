const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
        Los pagos en producción aún no están configurados. Completa la activación de pagos
        para cobrar de verdad.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-border bg-muted px-4 py-2 text-center text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Todos los pagos en la vista previa son de prueba
      </div>
    );
  }
  return null;
}

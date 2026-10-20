export const PROFILE_PAYMENT_METHODS = ["efectivo", "terminal"] as const;

export function cashReceivedCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function cashChangeCents(totalCents: number, receivedCents: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 ||
      !Number.isSafeInteger(receivedCents) || receivedCents < totalCents) {
    throw new Error("El efectivo recibido debe cubrir el total de la compra.");
  }
  return receivedCents - totalCents;
}
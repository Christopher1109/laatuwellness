// Ventana de venta de membresías promocionales (ej. Founders Access).
// El servidor vuelve a validar fecha y cupo al cobrar.
export type TimedPlan = {
  available_from?: string | null;
  available_until?: string | null;
};

export function isPlanInSaleWindow(plan: TimedPlan, now: Date = new Date()): boolean {
  if (plan.available_from && now < new Date(plan.available_from)) return false;
  if (plan.available_until && now > new Date(plan.available_until)) return false;
  return true;
}

export function spotsLeft(maxSales: number | null | undefined, sold: number): number | null {
  if (maxSales == null) return null;
  return Math.max(0, maxSales - sold);
}

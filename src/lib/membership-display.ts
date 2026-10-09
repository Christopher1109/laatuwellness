// Textos de membresía para el cliente: nunca muestran créditos ni saldo.
export function describeMembershipToday(dailyLimit: number, usedToday: number): string {
  const left = Math.max(0, dailyLimit - usedToday);
  if (dailyLimit === 1) return left > 0 ? "Clase de hoy: disponible" : "Ya reservaste tu clase de hoy";
  if (left === 0) return "Ya reservaste tus clases de hoy";
  return `Te quedan ${left} de ${dailyLimit} clases hoy`;
}

// Días completos que faltan para el vencimiento (redondeo hacia arriba).
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

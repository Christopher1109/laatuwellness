// Reglas de la política de cancelación y faltas, espejo de las funciones SQL
// (register_falta / miss_status). Los valores por defecto coinciden con la
// fila de cancellation_policy; la app lee la config real de esa tabla.

export type CancellationPolicy = {
  cancel_hours: number;
  free_misses: number;
  fine_cents: number;
};

export const DEFAULT_POLICY: CancellationPolicy = {
  cancel_hours: 12,
  free_misses: 2,
  fine_cents: 15000,
};

export function hoursUntil(startsAt: Date | string, now = Date.now()): number {
  return (new Date(startsAt).getTime() - now) / 3_600_000;
}

export function isLateCancel(startsAt: Date | string, cancelHours: number, now = Date.now()): boolean {
  return hoursUntil(startsAt, now) < cancelHours;
}

function money0(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

/** Aviso antes de confirmar una cancelación, según si la reserva usó créditos
 *  de paquete (tokensSpent > 0) o membresía (0). */
export function cancelWarning(opts: {
  startsAt: Date | string;
  tokensSpent: number;
  policy?: CancellationPolicy;
  now?: number;
}): string {
  const policy = opts.policy ?? DEFAULT_POLICY;
  if (!isLateCancel(opts.startsAt, policy.cancel_hours, opts.now)) {
    return opts.tokensSpent > 0
      ? `Faltan más de ${policy.cancel_hours} horas: se te regresa tu crédito.`
      : `Faltan más de ${policy.cancel_hours} horas: puedes cancelar sin problema.`;
  }
  if (opts.tokensSpent > 0) {
    return `Estás cancelando con menos de ${policy.cancel_hours} horas de anticipación; esta clase no se te regresará.`;
  }
  return `Estás cancelando con menos de ${policy.cancel_hours} horas de anticipación: contará como una falta. A la ${policy.free_misses + 1}ª falta se cobra una multa de ${money0(policy.fine_cents)} a tu tarjeta.`;
}

/** La multa se genera en la falta número freeMisses + 1 del ciclo. */
export function fineDueOnMiss(cycleCount: number, freeMisses: number): boolean {
  return cycleCount > freeMisses;
}

/** Posición dentro del ciclo: se reinicia tras la multa, no al renovar. */
export function cycleCount(totalMisses: number, freeMisses: number): number {
  if (totalMisses <= 0) return 0;
  return ((totalMisses - 1) % (freeMisses + 1)) + 1;
}

/** Aviso para la clienta después de cada falta (espejo de miss_status). */
export function missMessage(count: number, policy: CancellationPolicy = DEFAULT_POLICY): string | null {
  const fine = money0(policy.fine_cents);
  if (count === 1) {
    return `Tienes 1 falta. Recuerda que puedes cancelar sin costo hasta ${policy.cancel_hours} h antes. A la ${policy.free_misses + 1}ª falta se cobra una multa de ${fine}.`;
  }
  if (count === policy.free_misses) {
    return `Tienes ${count} faltas. Tu próxima falta generará una multa de ${fine}.`;
  }
  if (count > 1) {
    return `Tienes ${count} faltas. A la ${policy.free_misses + 1}ª falta se cobra una multa de ${fine}.`;
  }
  return null;
}

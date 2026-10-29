/**
 * Utilidades de dinero del punto de venta: leer lo que teclea el staff,
 * validar un pago mixto y repartir una venta mixta entre sus métodos de pago.
 */

/** Tope de un cobro de monto libre o de la parte en terminal: $200,000. */
export const MAX_POS_CENTS = 20_000_000;

/**
 * "1,250.50" / "$1250" / "1250,5" → centavos. Devuelve null si no es un
 * monto válido mayor a cero.
 */
export function parsePesos(raw: string): number | null {
  let s = raw.replace(/[\s$]/g, "");
  if (!s) return null;
  // "1250,5" (coma decimal) → punto; "1,250.50" (coma de miles) → sin coma.
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_POS_CENTS) return null;
  return cents;
}

export type MixedMethod = "efectivo" | "transferencia";

/**
 * Valida la parte que se cobra en terminal en un pago mixto. Regresa el
 * mensaje de error o null si está bien.
 */
export function mixedSplitError(cardCents: number | null, totalCents: number): string | null {
  if (totalCents <= 0) return "Agrega algo al cobro.";
  if (cardCents == null) return "Escribe cuánto se cobra en la terminal.";
  if (cardCents >= totalCents) {
    return "Lo de la terminal debe ser menor al total; si es todo, usa Tarjeta.";
  }
  return null;
}

/**
 * Reparte un monto según el desglose de pago de la venta
 * ({ tarjeta: 200000, efectivo: 145000 }). El último método se lleva el
 * residuo para que la suma cuadre al centavo. Sin desglose, regresa null.
 */
export function splitByPayment(
  amountCents: number,
  split: unknown,
): { method: string; cents: number }[] | null {
  if (!split || typeof split !== "object" || Array.isArray(split)) return null;
  const entries = Object.entries(split as Record<string, unknown>)
    .map(([method, v]) => [method, Number(v)] as const)
    .filter(([, v]) => Number.isFinite(v) && v > 0);
  const base = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0 || base <= 0) return null;
  let left = amountCents;
  return entries.map(([method, v], i) => {
    const cents = i === entries.length - 1 ? left : Math.round((amountCents * v) / base);
    left -= cents;
    return { method, cents };
  });
}

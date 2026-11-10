/**
 * Enfoque del día para clases que cambian de contenido según el día de la
 * semana. La clase se sigue llamando igual en el sistema (p. ej. "Start
 * Strong"), pero a las clientas se les muestra también qué toca ese día,
 * porque mucha gente no sabía qué día era lower, upper, etc.
 *
 * Los días se cuentan en hora de Monterrey: 0 = domingo … 6 = sábado.
 * Para cambiar o agregar un enfoque basta con editar este mapa.
 */
const DAILY_FOCUS: Record<string, Partial<Record<number, string>>> = {
  "start strong": {
    1: "Lower Strength",
    2: "Upper Strength",
    3: "Glutes & Core",
    4: "All Around",
  },
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Día de la semana (0 = domingo) de una fecha, en hora de Monterrey. */
export function monterreyWeekday(startsAt: string | Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/Monterrey",
  }).format(new Date(startsAt));
  return WEEKDAY_INDEX[short] ?? new Date(startsAt).getDay();
}

/** Enfoque del día para ese tipo de clase, o null si no aplica. */
export function classFocus(
  typeName: string | null | undefined,
  startsAt: string | Date,
): string | null {
  if (!typeName) return null;
  const byDay = DAILY_FOCUS[typeName.trim().toLowerCase()];
  return byDay?.[monterreyWeekday(startsAt)] ?? null;
}

/** "Start Strong · Lower Strength" (o solo el nombre si ese día no hay enfoque). */
export function classTitle<T extends string | null | undefined>(
  typeName: T,
  startsAt: string | Date,
): T | string {
  const focus = classFocus(typeName, startsAt);
  return focus ? `${typeName} · ${focus}` : typeName;
}

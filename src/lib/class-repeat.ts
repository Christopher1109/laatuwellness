/**
 * Fechas en las que se crea una clase agregada a mano desde Horarios de clases,
 * según cómo se quiera repetir. Todo en hora local del estudio.
 */
export type RepeatMode = "once" | "weekdays" | "week" | "weekly_month" | "weekly_until";

export const REPEAT_LABELS: Record<RepeatMode, string> = {
  once: "Solo ese día",
  weekdays: "Lunes a viernes de esa semana",
  week: "Toda esa semana (lunes a domingo)",
  weekly_month: "El mismo día cada semana, hasta fin de mes",
  weekly_until: "El mismo día cada semana, hasta una fecha",
};

/** "2026-11-04" → Date local a medianoche (sin desfase de zona horaria). */
export function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Lunes de la semana de `d`. */
function mondayOf(d: Date) {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/**
 * Días (a medianoche local) en los que se crea la clase. El límite de 62
 * evita crear cientos de clases por error.
 */
export function repeatDates(start: Date, mode: RepeatMode, until?: Date | null): Date[] {
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const out: Date[] = [];
  if (mode === "once") return [first];
  if (mode === "weekdays" || mode === "week") {
    const monday = mondayOf(first);
    const last = mode === "weekdays" ? 4 : 6;
    for (let i = 0; i <= last; i++) {
      const d = addDays(monday, i);
      if (d >= first) out.push(d);
    }
    return out;
  }
  const end =
    mode === "weekly_month"
      ? new Date(first.getFullYear(), first.getMonth() + 1, 0)
      : until
        ? new Date(until.getFullYear(), until.getMonth(), until.getDate())
        : first;
  for (let d = first; d <= end && out.length < 62; d = addDays(d, 7)) out.push(d);
  return out;
}

/** Combina un día con "HH:MM" en hora local. */
export function atTime(day: Date, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi);
}

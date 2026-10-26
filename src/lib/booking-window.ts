/**
 * Las clientas ven y reservan solo con una semana de anticipación: hoy y los
 * siete días siguientes completos (lunes 26 → hasta el lunes 2 inclusive).
 * Cada día que pasa se libera uno más. La base de datos aplica la misma regla
 * (booking_window_end) al leer clases y al reservar.
 */
export const BOOKING_WINDOW_DAYS = 7;

/** Primer instante fuera de la ventana (medianoche local de hoy + 8 días). */
export function bookingWindowEnd(now: Date = new Date()): Date {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + BOOKING_WINDOW_DAYS + 1);
  return end;
}

export function isWithinBookingWindow(date: Date, now: Date = new Date()): boolean {
  return date.getTime() < bookingWindowEnd(now).getTime();
}

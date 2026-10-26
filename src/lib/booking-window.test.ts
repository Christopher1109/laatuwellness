import { describe, expect, it } from "vitest";
import { bookingWindowEnd, isWithinBookingWindow } from "./booking-window";

describe("booking window", () => {
  it("abre hoy y los siete días siguientes completos", () => {
    const monday = new Date(2026, 9, 26, 12, 30);
    const end = bookingWindowEnd(monday);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(10);
    expect(end.getDate()).toBe(3);
    expect(end.getHours()).toBe(0);
  });

  it("incluye la última clase del lunes siguiente y excluye el martes", () => {
    const monday = new Date(2026, 9, 26, 8);
    expect(isWithinBookingWindow(new Date(2026, 10, 2, 19, 10), monday)).toBe(true);
    expect(isWithinBookingWindow(new Date(2026, 10, 3, 7, 0), monday)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { describeMembershipToday, daysUntil } from "./membership-display";

describe("estado de membresía", () => {
  it("Everyday sin reserva hoy", () => {
    expect(describeMembershipToday(1, 0)).toBe("Clase de hoy: disponible");
  });
  it("Everyday con reserva hoy", () => {
    expect(describeMembershipToday(1, 1)).toBe("Ya reservaste tu clase de hoy");
  });
  it("Two a Day con una reserva hoy", () => {
    expect(describeMembershipToday(2, 1)).toBe("Te quedan 1 de 2 clases hoy");
  });
  it("faltan 5 días para vencer", () => {
    expect(daysUntil("2026-11-14T05:59:59Z", new Date("2026-11-09T06:00:00Z"))).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { isPlanInSaleWindow, spotsLeft } from "./plan-availability";

// Founders Access: 8 oct 2026 00:00 a 31 oct 2026 23:59:59 hora de Monterrey (UTC-6).
const founders = {
  available_from: "2026-10-08T06:00:00Z",
  available_until: "2026-11-01T05:59:59Z",
};

describe("Founders Access", () => {
  it("se vende el 31 de octubre a las 23:58 de Monterrey", () => {
    expect(isPlanInSaleWindow(founders, new Date("2026-11-01T05:58:00Z"))).toBe(true);
  });
  it("se oculta después del 31 de octubre 23:59", () => {
    expect(isPlanInSaleWindow(founders, new Date("2026-11-01T06:00:30Z"))).toBe(false);
  });
  it("no se vende antes del 8 de octubre", () => {
    expect(isPlanInSaleWindow(founders, new Date("2026-10-08T05:00:00Z"))).toBe(false);
  });
  it("cupo de 25: con 25 vendidas quedan 0", () => {
    expect(spotsLeft(25, 25)).toBe(0);
    expect(spotsLeft(25, 3)).toBe(22);
  });
});

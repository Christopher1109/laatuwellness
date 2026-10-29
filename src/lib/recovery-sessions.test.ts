import { describe, expect, it } from "vitest";
import { summarizeSessions, type RecoverySession } from "./recovery-sessions";

const row = (over: Partial<RecoverySession>): RecoverySession => ({
  booking_id: Math.random().toString(),
  starts_at: "2026-11-03T16:00:00Z",
  client_name: "Ana",
  client_email: "ana@x.com",
  credit_kind: "doris_ul",
  status: "reservada",
  checked_in: true,
  price_cents: 85000,
  class_type: "Upper o Lower",
  ...over,
});

describe("resumen de consultas de DorisFisio", () => {
  it("cuenta por tipo y suma lo que vale cada una", () => {
    const s = summarizeSessions([
      row({}),
      row({ credit_kind: "doris_fb", price_cents: 120000 }),
      row({ starts_at: "2026-11-04T16:00:00Z" }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byKind.doris_ul).toEqual({ count: 2, cents: 170000 });
    expect(s.byKind.doris_fb).toEqual({ count: 1, cents: 120000 });
    expect(s.totalCents).toBe(290000);
    expect(s.byDay.map((d) => [d.day, d.sessions.length])).toEqual([
      ["2026-11-03", 2],
      ["2026-11-04", 1],
    ]);
  });

  it("agrupa por día en hora de Monterrey", () => {
    // 23:30 de Monterrey del 3 = 05:30 UTC del 4
    const s = summarizeSessions([row({ starts_at: "2026-11-04T05:30:00Z" })]);
    expect(s.byDay[0]!.day).toBe("2026-11-03");
  });
});

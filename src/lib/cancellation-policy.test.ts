import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  cancelWarning,
  cycleCount,
  fineDueOnMiss,
  isLateCancel,
  missMessage,
} from "./cancellation-policy";

const NOW = new Date("2026-11-18T12:00:00-06:00").getTime();
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe("ventana de cancelación de 12 horas", () => {
  it("cancelar con 12 horas o más no tiene penalización", () => {
    expect(isLateCancel(inHours(12), DEFAULT_POLICY.cancel_hours, NOW)).toBe(false);
    expect(isLateCancel(inHours(30), DEFAULT_POLICY.cancel_hours, NOW)).toBe(false);
  });

  it("cancelar con menos de 12 horas es tardía", () => {
    expect(isLateCancel(inHours(11.9), DEFAULT_POLICY.cancel_hours, NOW)).toBe(true);
    expect(isLateCancel(inHours(1), DEFAULT_POLICY.cancel_hours, NOW)).toBe(true);
  });

  it("respeta las horas configuradas en el panel", () => {
    expect(isLateCancel(inHours(5), 6, NOW)).toBe(true);
    expect(isLateCancel(inHours(7), 6, NOW)).toBe(false);
  });
});

describe("aviso al cancelar", () => {
  it("paquete con cancelación tardía: la clase no se regresa", () => {
    const msg = cancelWarning({ startsAt: inHours(2), tokensSpent: 1, now: NOW });
    expect(msg).toContain("esta clase no se te regresará");
  });

  it("membresía con cancelación tardía: cuenta como falta y avisa la multa", () => {
    const msg = cancelWarning({ startsAt: inHours(2), tokensSpent: 0, now: NOW });
    expect(msg).toContain("contará como una falta");
    expect(msg).toContain("3ª falta");
    expect(msg).toContain("$150");
  });

  it("a tiempo: paquete recupera el crédito, membresía cancela sin problema", () => {
    expect(cancelWarning({ startsAt: inHours(20), tokensSpent: 1, now: NOW })).toContain(
      "se te regresa tu crédito",
    );
    expect(cancelWarning({ startsAt: inHours(20), tokensSpent: 0, now: NOW })).toContain(
      "sin problema",
    );
  });
});

describe("regla de la 3ª falta", () => {
  it("las primeras 2 faltas no cobran; la 3ª sí", () => {
    expect(fineDueOnMiss(1, 2)).toBe(false);
    expect(fineDueOnMiss(2, 2)).toBe(false);
    expect(fineDueOnMiss(3, 2)).toBe(true);
  });

  it("el contador se reinicia después de la multa, no al renovar", () => {
    // 4 faltas acumuladas = multa en la 3ª + 1 del nuevo ciclo.
    expect(cycleCount(4, 2)).toBe(1);
    expect(cycleCount(5, 2)).toBe(2);
    expect(cycleCount(6, 2)).toBe(3);
    expect(fineDueOnMiss(cycleCount(6, 2), 2)).toBe(true);
  });
});

describe("avisos a la clienta", () => {
  it("tras la 1ª falta explica la regla", () => {
    expect(missMessage(1)).toBe(
      "Tienes 1 falta. Recuerda que puedes cancelar sin costo hasta 12 h antes. A la 3ª falta se cobra una multa de $150.",
    );
  });

  it("tras la 2ª falta avisa que la siguiente cobra", () => {
    expect(missMessage(2)).toBe("Tienes 2 faltas. Tu próxima falta generará una multa de $150.");
  });

  it("sin faltas no hay aviso", () => {
    expect(missMessage(0)).toBeNull();
  });
});

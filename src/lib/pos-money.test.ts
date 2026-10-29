import { describe, expect, it } from "vitest";
import { mixedSplitError, parsePesos, splitByPayment } from "./pos-money";

describe("parsePesos", () => {
  it("lee montos con o sin formato", () => {
    expect(parsePesos("1250")).toBe(125000);
    expect(parsePesos("$1,250.50")).toBe(125050);
    expect(parsePesos("1250,5")).toBe(125050);
    expect(parsePesos(" 99.9 ")).toBe(9990);
  });
  it("rechaza vacíos, ceros, negativos y basura", () => {
    expect(parsePesos("")).toBeNull();
    expect(parsePesos("0")).toBeNull();
    expect(parsePesos("-50")).toBeNull();
    expect(parsePesos("12.345")).toBeNull();
    expect(parsePesos("abc")).toBeNull();
    expect(parsePesos("300000")).toBeNull();
  });
});

describe("mixedSplitError", () => {
  it("pide una parte menor al total", () => {
    expect(mixedSplitError(null, 345000)).toMatch(/terminal/);
    expect(mixedSplitError(345000, 345000)).toMatch(/menor/);
    expect(mixedSplitError(200000, 345000)).toBeNull();
  });
});

describe("splitByPayment", () => {
  it("reparte en proporción y cuadra al centavo", () => {
    const parts = splitByPayment(1000, { tarjeta: 2, efectivo: 1 })!;
    expect(parts).toEqual([
      { method: "tarjeta", cents: 667 },
      { method: "efectivo", cents: 333 },
    ]);
    expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(1000);
  });
  it("sin desglose regresa null", () => {
    expect(splitByPayment(1000, null)).toBeNull();
    expect(splitByPayment(1000, {})).toBeNull();
  });
});

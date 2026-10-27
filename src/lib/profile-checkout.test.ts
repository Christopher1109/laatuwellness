import { describe, expect, it } from "vitest";
import { PROFILE_PAYMENT_METHODS, cashChangeCents, cashReceivedCents } from "./profile-checkout";

describe("client profile checkout", () => {
  it("offers cash, bank transfer or actual terminal collection", () => {
    expect([...PROFILE_PAYMENT_METHODS]).toEqual(["efectivo", "transferencia", "terminal"]);
  });
  it("rejects cash that does not cover the purchase", () => {
    expect(() => cashChangeCents(37000, 36900)).toThrow();
  });
  it("calculates change for a $370 purchase paid with $500", () => {
    expect(cashChangeCents(37000, 50000)).toBe(13000);
  });
  it("allows exact cash payment", () => {
    expect(cashChangeCents(37000, 37000)).toBe(0);
  });
  it("requires an explicit valid cash amount", () => {
    expect(cashReceivedCents("")).toBeNull();
    expect(cashReceivedCents("-500")).toBeNull();
    expect(cashReceivedCents("500.001")).toBeNull();
    expect(cashReceivedCents("500.50")).toBe(50050);
  });
});

import { describe, expect, it } from "vitest";
import { groupClientPurchases, matchesClientPurchaseFilter } from "./client-purchases";

describe("client purchase labels and filters", () => {
  it("includes only completed purchases, not unpaid or refunded sales", () => {
    const rows = ["completed", "pending", "refunded"].map((status) => ({
      user_id: "camila", plan_id: "newcomer", status, token_plans: { name: "Newcomer" },
    }));
    expect(groupClientPurchases(rows).get("camila")).toEqual([{ planId: "newcomer", name: "Newcomer", count: 1 }]);
  });
  it("groups repeat purchases into one label with their sale count", () => {
    const row = { user_id: "juan", plan_id: "five", status: "completed", token_plans: { name: "5 Classes" } };
    expect(groupClientPurchases([row, row]).get("juan")).toEqual([{ planId: "five", name: "5 Classes", count: 2 }]);
  });
  const client = { full_name: "Camila Gutiérrez", email: "camila@example.test", purchases: [{ planId: "newcomer", name: "Newcomer", count: 1 }] };
  it("searches clients by purchased package name", () => {
    expect(matchesClientPurchaseFilter(client, "newcomer", "all")).toBe(true);
    expect(matchesClientPurchaseFilter(client, "5 Classes", "all")).toBe(false);
  });
  it("combines package selection and text search", () => {
    expect(matchesClientPurchaseFilter(client, "gutierrez", "newcomer")).toBe(true);
    expect(matchesClientPurchaseFilter(client, "camila", "five")).toBe(false);
    expect(matchesClientPurchaseFilter(client, "monica", "newcomer")).toBe(false);
  });
});
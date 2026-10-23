import { describe, expect, it } from "vitest";
import { appTeamDestination } from "./app-team-navigation";

describe("app team panel destination", () => {
  it("opens the shared web panel for administrators", () => {
    expect(appTeamDestination({ isAdmin: true, isStaff: false, isCoach: false })).toBe("/admin");
  });
  it("opens the shared web panel for staff without changing their permissions", () => {
    expect(appTeamDestination({ isAdmin: false, isStaff: true, isCoach: false })).toBe("/admin");
  });
  it("opens the shared web panel for coaches without expanding access", () => {
    expect(appTeamDestination({ isAdmin: false, isStaff: true, isCoach: true })).toBe("/admin");
  });
  it("keeps clients in the customer app", () => {
    expect(appTeamDestination({ isAdmin: false, isStaff: false, isCoach: false })).toBeNull();
  });
});
import { describe, expect, it } from "vitest";
import { classFocus, classTitle, monterreyWeekday } from "./class-focus";

describe("enfoque del día", () => {
  it("usa el día de Monterrey aunque en UTC ya sea otro día", () => {
    // Lunes 9 nov 2026, 19:00 en Monterrey = martes 01:00 UTC.
    expect(monterreyWeekday("2026-11-10T01:00:00Z")).toBe(1);
  });

  it("marca el enfoque de Start Strong de lunes a jueves", () => {
    expect(classTitle("Start Strong", "2026-11-09T14:00:00Z")).toBe(
      "Start Strong · Lower Strength",
    );
    expect(classFocus("Start Strong", "2026-11-10T14:00:00Z")).toBe("Upper Strength");
    expect(classFocus("start strong ", "2026-11-11T14:00:00Z")).toBe("Glutes & Core");
    expect(classFocus("Start Strong", "2026-11-12T14:00:00Z")).toBe("All Around");
  });

  it("deja el nombre igual los demás días y en otras clases", () => {
    expect(classTitle("Start Strong", "2026-11-13T14:00:00Z")).toBe("Start Strong");
    expect(classTitle("Pilates Mat", "2026-11-09T14:00:00Z")).toBe("Pilates Mat");
    expect(classTitle(undefined, "2026-11-09T14:00:00Z")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { atTime, parseLocalDate, repeatDates } from "./class-repeat";

const ymd = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

describe("repetición de clases agregadas a mano", () => {
  const wed = parseLocalDate("2026-11-04")!; // miércoles

  it("solo ese día", () => {
    expect(repeatDates(wed, "once").map(ymd)).toEqual(["11/4"]);
  });

  it("lunes a viernes de esa semana, desde el día elegido", () => {
    expect(repeatDates(wed, "weekdays").map(ymd)).toEqual(["11/4", "11/5", "11/6"]);
  });

  it("toda la semana llega al domingo", () => {
    expect(repeatDates(wed, "week").map(ymd)).toEqual(["11/4", "11/5", "11/6", "11/7", "11/8"]);
  });

  it("mismo día cada semana hasta fin de mes", () => {
    expect(repeatDates(wed, "weekly_month").map(ymd)).toEqual(["11/4", "11/11", "11/18", "11/25"]);
  });

  it("mismo día cada semana hasta una fecha (incluida)", () => {
    expect(repeatDates(wed, "weekly_until", parseLocalDate("2026-12-02")).map(ymd)).toEqual([
      "11/4",
      "11/11",
      "11/18",
      "11/25",
      "12/2",
    ]);
  });

  it("arma la hora local y rechaza horas inválidas", () => {
    const d = atTime(wed, "08:15")!;
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([8, 15, 4]);
    expect(atTime(wed, "25:00")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
  });
});

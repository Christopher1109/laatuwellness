import { describe, expect, it } from "vitest";
import { buildReminderEmail, type ReminderRow } from "./membership-emails";

const base: ReminderRow = {
  user_id: "u1",
  email: "ana@example.com",
  full_name: "ana LÓPEZ",
  plan_name: "Founders Access",
  ends_at: "2026-12-03T05:59:59+00:00",
  is_founders: true,
  auto_renew_plan: null,
};

describe("buildReminderEmail", () => {
  it("Founders: incluye las 3 opciones, la política y la fecha local", () => {
    const e = buildReminderEmail(base);
    expect(e.template).toBe("founders");
    expect(e.text).toContain("¡Hola, Ana!");
    expect(e.text).toContain("termina el 2 de diciembre");
    expect(e.text).toContain("$4,299/mes");
    expect(e.text).toContain("$24,000");
    expect(e.text).toContain("$4,700/mes");
    expect(e.text).toContain("12 horas");
    expect(e.html).toContain("https://laatuwellness.com/cuenta");
  });

  it("genérico: sin precios", () => {
    const e = buildReminderEmail({ ...base, is_founders: false, plan_name: "The Everyday" });
    expect(e.template).toBe("generica");
    expect(e.text).toContain("The Everyday");
    expect(e.text).not.toMatch(/\$\d/);
  });

  it("con renovación automática activa no pide renovar", () => {
    const e = buildReminderEmail({ ...base, auto_renew_plan: "Founders Access · Mensual recurrente" });
    expect(e.template).toBe("renovacion_automatica");
    expect(e.text).toContain("se renovará automáticamente");
  });

  it("escapa el nombre en el HTML", () => {
    const e = buildReminderEmail({ ...base, full_name: "<b>x</b>" });
    expect(e.html).not.toContain("<b>x</b>");
  });
});

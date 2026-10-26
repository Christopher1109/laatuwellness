import { describe, expect, it } from "vitest";
import { validateTeamMember } from "./team-member";

describe("team member validation", () => {
  it("normaliza correo, color y deja la contraseña opcional", () => {
    const v = validateTeamMember({
      fullName: "  Recepción 1 ",
      email: " Staff1@LaatuWellness.com ",
      role: "staff",
      hourlyRateCents: 12000,
      color: "d165c7",
    });
    expect(v.fullName).toBe("Recepción 1");
    expect(v.email).toBe("staff1@laatuwellness.com");
    expect(v.color).toBe("#D165C7");
    expect(v.password).toBeNull();
    expect(v.active).toBe(true);
  });

  it("pide un correo cuando se asigna contraseña", () => {
    expect(() =>
      validateTeamMember({ fullName: "Eli", email: "", role: "coach", password: "segura123" }),
    ).toThrow("necesita un correo");
  });

  it("rechaza contraseñas cortas y roles desconocidos", () => {
    expect(() =>
      validateTeamMember({ fullName: "Eli", email: "eli@x.com", role: "coach", password: "123" }),
    ).toThrow("entre 8 y 72");
    expect(() =>
      validateTeamMember({ fullName: "Eli", email: "eli@x.com", role: "user" as never }),
    ).toThrow("Rol inválido");
  });
});

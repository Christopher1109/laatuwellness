import { describe, expect, it } from "vitest";
import { STAFF_PANEL_SECTIONS, canStaffAccessPanel } from "./admin-navigation";

describe("staff panel access", () => {
  it("allows all Operation sections including the iPad check-in shortcut", () => {
    expect(STAFF_PANEL_SECTIONS.operation).toEqual(["programacion", "horarios-clases", "horarios-consultorio", "pos", "pedidos", "inventario", "check-in"]);
    for (const key of STAFF_PANEL_SECTIONS.operation) expect(canStaffAccessPanel(key)).toBe(true);
  });
  it("allows staff to open check-in from the tablet home panel", () => {
    expect(canStaffAccessPanel("check-in")).toBe(true);
  });
  it("allows only Clients in People", () => {
    expect(STAFF_PANEL_SECTIONS.people).toEqual(["clientes"]);
    expect(canStaffAccessPanel("clientes")).toBe(true);
    for (const key of ["staff", "coaches", "nomina"]) expect(canStaffAccessPanel(key)).toBe(false);
  });
  it("allows only Packages, Merch, Goddes´s and Coupons in Business", () => {
    expect(STAFF_PANEL_SECTIONS.business).toEqual(["paquetes", "merch", "goodes", "cupones"]);
    for (const key of STAFF_PANEL_SECTIONS.business) expect(canStaffAccessPanel(key)).toBe(true);
    for (const key of ["finanzas", "kardex"]) expect(canStaffAccessPanel(key)).toBe(false);
  });
});
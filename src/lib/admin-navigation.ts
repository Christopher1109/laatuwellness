export const STAFF_PANEL_SECTIONS = {
  operation: [
    "programacion",
    "horarios-clases",
    "horarios-consultorio",
    "pos",
    "pedidos",
    "inventario",
    "check-in",
  ],
  people: ["clientes"],
  business: ["paquetes", "merch", "goodes", "cupones"],
} as const;

export function canStaffAccessPanel(key: string) {
  return (
    key === "inicio" ||
    Object.values(STAFF_PANEL_SECTIONS).some((keys) => (keys as readonly string[]).includes(key))
  );
}

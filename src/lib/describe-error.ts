// Convierte errores de Supabase/Postgres (que NO son instancias de Error, por
// eso antes se mostraba siempre el mensaje genérico) en un texto claro.

const KNOWN: Record<string, string> = {
  FORBIDDEN: "Tu usuario no tiene permiso para hacer esto.",
  PLAN_NOT_FOUND: "Ese paquete ya no está disponible.",
  PLAN_NOT_AVAILABLE: "Ese paquete ya no está disponible.",
  PLAN_ALREADY_PURCHASED: "Este paquete solo se puede comprar una vez por cuenta y ya se compró.",
  NEW_CLIENTS_ONLY:
    "Este paquete es solo para clientes nuevos, y esta cuenta ya tiene compras anteriores.",
  PLAN_ONLY_ONE: "Este paquete solo se puede agregar una vez.",
  PLAN_SALE_REQUIRES_CLIENT: "Para vender paquetes o clases hay que elegir al cliente.",
  AUTH_REQUIRED: "Inicia sesión para continuar.",
  COUPON_NOT_FOUND: "Ese cupón no existe o ya no está activo.",
  COUPON_EXHAUSTED: "Ese cupón ya alcanzó su límite de usos.",
  COUPON_ALREADY_USED: "Ya usaste este cupón el máximo de veces permitido.",
  COUPON_NEW_CLIENTS_ONLY: "Este cupón es solo para clientes nuevos.",
};

export function describeError(error: unknown, fallback = "Ocurrió un error."): string {
  if (!error) return fallback;
  const raw =
    typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message ?? "")
        : "";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code ?? "")
      : "";

  for (const [key, text] of Object.entries(KNOWN)) {
    if (raw.includes(key)) return text;
  }
  // Función o tabla que no existe en la base de datos: falta aplicar una migración.
  if (code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01") {
    return "Falta una actualización de la base de datos para esta función. Avísale al administrador del sistema.";
  }
  return raw || fallback;
}

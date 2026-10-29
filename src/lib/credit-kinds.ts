/**
 * Tipos de crédito. Los de DorisFisio están etiquetados: un crédito de
 * "Upper o Lower" solo sirve para esa sesión y uno de "Full Body" solo para
 * Full Body. Los del estudio (general) no sirven en el consultorio.
 */
export type CreditKind = "general" | "doris_ul" | "doris_fb";

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  general: "Clases del estudio",
  doris_ul: "DorisFisio · Upper o Lower",
  doris_fb: "DorisFisio · Full Body",
};

export const CREDIT_KIND_SHORT: Record<CreditKind, string> = {
  general: "Estudio",
  doris_ul: "Upper o Lower",
  doris_fb: "Full Body",
};

export const DORIS_KINDS: readonly CreditKind[] = ["doris_ul", "doris_fb"];

export function creditKindOf(value: string | null | undefined): CreditKind {
  return value === "doris_ul" || value === "doris_fb" ? value : "general";
}

/** Roles del equipo como se muestran en el panel. */
export const TEAM_ROLE_LABELS: Record<string, string> = {
  admin: "Administración",
  staff: "Staff / recepción",
  coach: "Coach",
  recovery: "Recovery (DorisFisio)",
};

/** Mensajes cuando no alcanza el crédito del tipo correcto. */
export const CREDIT_ERRORS: Record<string, string> = {
  INSUFFICIENT_TOKENS_UPPER_LOWER:
    "Esta sesión es Upper o Lower y no hay créditos de DorisFisio Upper o Lower disponibles.",
  INSUFFICIENT_TOKENS_FULL_BODY:
    "Esta sesión es Full Body y no hay créditos de DorisFisio Full Body disponibles (un crédito de Upper o Lower no sirve para Full Body).",
  INSUFFICIENT_TOKENS_DORIS:
    "Para el consultorio de DorisFisio se necesita un crédito de DorisFisio (Upper o Lower, o Full Body).",
};

import type { CSSProperties } from "react";

const HEX = /^#?([0-9a-f]{6})$/i;

/** Normaliza un color a #RRGGBB, o null si no es válido. */
export function normalizeHex(value: string | null | undefined): string | null {
  const m = HEX.exec((value ?? "").trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
}

/** Texto oscuro o claro según la luminosidad del fondo. */
export function readableTextOn(hex: string): string {
  const n = normalizeHex(hex);
  if (!n) return "inherit";
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f1f1f" : "#ffffff";
}

/** Estilo de fondo + texto para un bloque con el color del coach. */
export function coachSwatch(color: string | null | undefined): CSSProperties | undefined {
  const n = normalizeHex(color);
  if (!n) return undefined;
  return { backgroundColor: n, color: readableTextOn(n) };
}

import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import principalInk from "@/assets/laatu-principal-ink.png.asset.json";
import principalIvory from "@/assets/laatu-principal-ivory.png.asset.json";
import letragramaInk from "@/assets/laatu-letragrama-ink.png.asset.json";
import letragramaIvory from "@/assets/laatu-letragrama-ivory.png.asset.json";
import stackInk from "@/assets/laatu-stack2-ink.png.asset.json";
import stackIvory from "@/assets/laatu-stack2-ivory.png.asset.json";
import patron from "@/assets/laatu-patron-ink.png.asset.json";
import iconoInk from "@/assets/laatu-icono-ink.png.asset.json";
import iconoIvory from "@/assets/laatu-icono-ivory.png.asset.json";

type Tone = "ink" | "ivory";

/**
 * Logotipos oficiales Läätu Wellness, extraídos de los vectores del Manual de
 * Identidad (variantes 1.2.1.2, 1.2.1.3 y 1.2.3.2). Nunca estirar, rotar ni
 * recolorear: usar `tone="ink"` (Shadow Blue) sobre Ivory y `tone="ivory"`
 * sobre Shadow Blue / Stone Blue.
 *
 *   variant="principal"  → LÄÄTU. + WELLNESS (logotipo principal)
 *   variant="letragrama" → LÄÄTU. en una línea
 *   variant="stack"      → LÄÄ / TU. apilado (variante versátil)
 */
export function Wordmark({
  className,
  tone = "ink",
  variant = "principal",
}: {
  className?: string;
  tone?: Tone;
  variant?: "principal" | "letragrama" | "stack";
}) {
  const src =
    variant === "stack"
      ? tone === "ivory"
        ? stackIvory.url
        : stackInk.url
      : variant === "letragrama"
        ? tone === "ivory"
          ? letragramaIvory.url
          : letragramaInk.url
        : tone === "ivory"
          ? principalIvory.url
          : principalInk.url;

  return (
    <img
      src={src}
      alt="Läätu Wellness"
      className={cn("w-auto object-contain", className)}
      loading="eager"
      decoding="async"
    />
  );
}

export function BrandLink({ className, tone = "ink" }: { className?: string; tone?: Tone }) {
  return (
    <Link
      to="/"
      aria-label="Läätu Wellness — Inicio"
      className={cn("flex items-center", className)}
    >
      <Wordmark tone={tone} variant="principal" className="h-11 sm:h-20" />
    </Link>
  );
}

/** Patrón de círculos del manual (1.4.1.2), como textura de fondo. */
export function CirclePattern({ className, tone = "ink" }: { className?: string; tone?: Tone }) {
  return (
    <img
      src={tone === "ivory" ? "/brand/laatu-patron-ivory.png" : patron.url}
      alt=""
      aria-hidden="true"
      className={cn("pointer-events-none select-none object-cover", className)}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * Isotipo oficial Läätu (1.3.1.1): la grulla de origami en constelación.
 */
export function BirdMark({ className, tone = "ink" }: { className?: string; tone?: Tone }) {
  return (
    <img
      src={tone === "ivory" ? iconoIvory.url : iconoInk.url}
      alt=""
      aria-hidden="true"
      className={cn("w-auto object-contain", className)}
      loading="lazy"
      decoding="async"
    />
  );
}

const BIRD_SRC = {
  1: {
    ink: "/brand/laatu-icono-bold-ink.png",
    ivory: "/brand/laatu-icono-bold-ivory.png",
  },
  2: {
    ink: "/brand/laatu-icono-v1-bold-ink.png",
    ivory: "/brand/laatu-icono-v1-bold-ivory.png",
  },
  3: {
    ink: "/brand/laatu-icono-v2-bold-ink.png",
    ivory: "/brand/laatu-icono-v2-bold-ivory.png",
  },
} as const;

/**
 * Isotipo con trazo reforzado dentro de una placa cuadrada Shadow Blue:
 * a tamaños pequeños el trazo original de la constelación se perdía sobre
 * Ivory. `variant` alterna entre el isotipo principal y sus dos variantes
 * oficiales (1.3.1.2 y 1.3.3.2).
 */
export function BirdBadge({
  className,
  size = "md",
  variant = 1,
  tone = "ink",
}: {
  className?: string;
  size?: "sm" | "md";
  variant?: 1 | 2 | 3;
  tone?: Tone;
}) {
  const dark = tone === "ink";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[2px] transition-colors",
        dark ? "bg-foreground group-hover:bg-secondary" : "border border-current/25 bg-transparent",
        size === "sm" ? "h-12 w-12" : "h-16 w-16",
        className,
      )}
    >
      <img
        src={BIRD_SRC[variant].ivory}
        alt=""
        aria-hidden="true"
        className={cn("w-auto object-contain", size === "sm" ? "h-6" : "h-8")}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}

/**
 * Campo de patrón de círculos: textura de marca posicionable en cualquier
 * sección, con recorte y opacidad controlados.
 */
export function PatternField({
  className,
  tone = "ink",
  opacity = 0.14,
}: {
  className?: string;
  tone?: Tone;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute overflow-hidden select-none", className)}
      style={{ opacity }}
    >
      <CirclePattern tone={tone} className="h-full w-full" />
    </div>
  );
}

/** Alias histórico. */
export const ArrowMark = BirdMark;

/** Separador de sección: línea + punto, lenguaje de constelación del manual. */
export function Constellation({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 text-current", className)} aria-hidden="true">
      <span className="rule-line flex-1" />
      <span className="flex items-center gap-1.5">
        <span className="block h-1 w-1 rounded-full bg-current opacity-60" />
        <span className="block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        <span className="block h-1 w-1 rounded-full bg-current opacity-60" />
      </span>
      <span className="rule-line flex-1" />
    </div>
  );
}

/** Coordenadas del estudio, recurso gráfico recurrente del manual. */
export function Coordinates({ className }: { className?: string }) {
  return (
    <p className={cn("font-mono text-[0.6rem] tracking-[0.24em] uppercase opacity-70", className)}>
      25° 39′ 51″ N · 100° 24′ 06″ O
    </p>
  );
}

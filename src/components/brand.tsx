import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import principalInk from "@/assets/laatu-principal-ink.png.asset.json";
import principalIvory from "@/assets/laatu-principal-ivory.png.asset.json";
import letragramaInk from "@/assets/laatu-letragrama-ink.png.asset.json";
import letragramaIvory from "@/assets/laatu-letragrama-ivory.png.asset.json";
import stackInk from "@/assets/laatu-stack2-ink.png.asset.json";
import stackIvory from "@/assets/laatu-stack2-ivory.png.asset.json";
import patron from "@/assets/laatu-patron-ink.png.asset.json";

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

export function BrandLink({
  className,
  tone = "ink",
}: {
  className?: string;
  tone?: Tone;
}) {
  return (
    <Link
      to="/"
      aria-label="Läätu Wellness — Inicio"
      className={cn("flex items-center", className)}
    >
      <Wordmark tone={tone} variant="principal" className="h-11 sm:h-14" />
    </Link>
  );
}

/** Patrón de círculos del manual (1.4.1.2), como textura de fondo. */
export function CirclePattern({ className }: { className?: string }) {
  return (
    <img
      src={patron.url}
      alt=""
      aria-hidden="true"
      className={cn("pointer-events-none select-none object-cover", className)}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * Acento gráfico de marca: la "Ä" del letragrama es una flecha ascendente.
 * Se reutiliza como bullet/viñeta en listas y tarjetas.
 */
export function ArrowMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    >
      <path d="M4 21 L12 3 L20 21 L12 14 Z" />
      <circle cx="8.5" cy="1.8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="1.8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Separador de sección: línea + punto, lenguaje de constelación del manual. */
export function Constellation({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center gap-4 text-current", className)}
      aria-hidden="true"
    >
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
    <p
      className={cn(
        "font-mono text-[0.6rem] tracking-[0.24em] uppercase opacity-70",
        className,
      )}
    >
      25° 39′ 51″ N · 100° 24′ 06″ O
    </p>
  );
}

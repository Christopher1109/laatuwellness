import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import wordmarkDark from "@/assets/laatu-wordmark-dark.png.asset.json";
import wordmarkLight from "@/assets/laatu-wordmark-light.png.asset.json";

/**
 * Logotipo oficial Läätu Wellness. Nunca estirar, rotar ni recolorear:
 * usar la variante `tone="ink"` sobre fondos claros y `tone="ivory"`
 * sobre fondos oscuros (Shadow Blue / Stone Blue).
 */
export function Wordmark({
  className,
  tone = "ink",
}: {
  className?: string;
  tone?: "ink" | "ivory";
}) {
  const asset = tone === "ivory" ? wordmarkLight : wordmarkDark;

  return (
    <img
      src={asset.url}
      alt="Läätu Wellness"
      className={cn("h-8 w-auto object-contain", className)}
      loading="eager"
      decoding="async"
    />
  );
}


export function BrandLink({ className, tone = "ink" }: { className?: string; tone?: "ink" | "ivory" }) {
  return (
    <Link to="/" aria-label="Läätu Wellness — Inicio" className={cn("group flex items-center", className)}>
      <Wordmark tone={tone} className="h-7 sm:h-8" />
    </Link>
  );
}

/**
 * Ícono de marca: ave figurativa tipo origami construida con líneas y puntos
 * (trayecto A→B / constelación). Variantes de posición vía `variant`.
 */
export function BirdMark({
  className,
  variant = "rise",
}: {
  className?: string;
  variant?: "rise" | "glide";
}) {
  const paths =
    variant === "rise"
      ? "M3 18 L12 4 L14.5 12.5 L21 9 L13.5 20 Z"
      : "M2 12 L11 6 L13 13 L22 11 L12 19 Z";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinejoin="round"
    >
      <path d={paths} />
      <circle cx="3" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="21" cy="9" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Separador de sección tipo constelación. */
export function Constellation({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 text-current", className)} aria-hidden="true">
      <span className="rule-line flex-1" />
      <BirdMark className="h-4 w-4 opacity-70" variant="glide" />
      <span className="rule-line flex-1" />
    </div>
  );
}

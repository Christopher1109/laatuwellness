import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// Cuánto tiempo deja de aparecer después de cerrarlo.
const DISMISS_KEY = "laatu-meet-popup-dismissed-at";
const DISMISS_MS = 3 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 1500;

// Páginas donde no tiene sentido invitar a registrarse.
const HIDDEN_PATHS = ["/auth", "/reset-password", "/checkout"];

function dismissedRecently() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Sin almacenamiento (modo privado, etc.): solo se cierra por ahora.
  }
}

/**
 * Meet LAATU: invita a quien visita la página sin sesión a crear su cuenta;
 * al registrarse recibe una clase de regalo (se asigna sola en la base de
 * datos). `onSettled` avisa cuando ya no se va a mostrar o se cerró, para que
 * la invitación a instalar la app no salga encima.
 */
export function MeetLaatuPopup({ onSettled }: { onSettled: () => void }) {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);

  const hiddenHere = HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (settled || loading) return;
    if (user || hiddenHere || dismissedRecently()) {
      setOpen(false);
      setSettled(true);
      onSettled();
      return;
    }
    const t = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [user, loading, hiddenHere, settled, onSettled]);

  // Si inicia sesión mientras está abierto, se cierra solo.
  useEffect(() => {
    if (open && user) {
      setOpen(false);
      setSettled(true);
      onSettled();
    }
  }, [open, user, onSettled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close es estable para este uso
  }, [open]);

  const close = () => {
    rememberDismiss();
    setOpen(false);
    setSettled(true);
    onSettled();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="meet-laatu-title"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-foreground/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={close}
    >
      <div
        className="relative grid max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto border border-border bg-background shadow-[0_30px_80px_-30px_rgba(39,40,56,0.6)] sm:grid-cols-[0.9fr_1.1fr]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label="Cerrar"
          className="absolute right-4 top-4 z-[1] bg-background/80 p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative hidden min-h-[22rem] sm:block">
          <img
            src="/foto-editorial/laatu-editorial-2.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div className="p-6 sm:p-10">
          <p className="eyebrow">Meet LAATU</p>
          <h2
            id="meet-laatu-title"
            className="statement mt-4 text-[1.7rem] leading-tight sm:text-[2.1rem]"
          >
            Tu primera clase va por nuestra cuenta.
          </h2>
          <p className="mt-5 text-sm text-muted-foreground">
            Crea tu cuenta en LAATU y te regalamos una clase para que nos conozcas. Se agrega sola a
            tu perfil en cuanto te registras.
          </p>
          <ol className="mt-6 space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="font-mono text-[0.7rem] text-muted-foreground">01</span>
              Regístrate con tu correo o Google.
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-[0.7rem] text-muted-foreground">02</span>
              Firma tu waiver digital desde tu cuenta.
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-[0.7rem] text-muted-foreground">03</span>
              Reserva tu clase de regalo.
            </li>
          </ol>

          <div className="mt-8 grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <Link
              to="/auth"
              search={{ mode: "up" }}
              onClick={close}
              className="bg-foreground px-7 py-3.5 text-center text-[0.7rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85"
            >
              Quiero mi clase gratis
            </Link>
            <button
              onClick={close}
              className="px-7 py-3.5 text-center text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Ahora no
            </button>
          </div>
          <p className="mt-6 text-[0.68rem] text-muted-foreground">
            Válido una sola vez por cuenta nueva. Vigencia de 30 días desde tu registro.
          </p>
        </div>
      </div>
    </div>
  );
}

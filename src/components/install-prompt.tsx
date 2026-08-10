import { useEffect, useState } from "react";
import { X, Share, Plus, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "laatu-install-prompt-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Invitación a instalar Läätu en la pantalla de inicio.
 * En Android/Chrome dispara el instalador nativo; en iOS muestra los pasos
 * visuales de "Compartir → Añadir a inicio".
 */
export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return;

    const ua = window.navigator.userAgent;
    const esIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
    setIos(esIos);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const t = window.setTimeout(() => setOpen(true), esIos ? 1800 : 2600);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(t);
    };
  }, []);

  const close = (recordar = true) => {
    if (recordar) window.localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    close();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Instalar Läätu"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-shadow/60 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="relative w-full max-w-md border border-border bg-background p-8 shadow-[0_30px_80px_-30px_rgba(39,40,56,0.6)]">
        <button
          onClick={() => close()}
          aria-label="Cerrar"
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <img
          src="/icon-192.png"
          alt="Läätu"
          className="h-16 w-16 border border-border object-contain"
        />

        <p className="eyebrow mt-6">Läätu en tu bolsillo</p>
        <h2 className="statement mt-3 text-[1.7rem] leading-tight">
          Tennos en la comodidad de tu mano.
        </h2>
        <p className="mt-4 text-sm text-muted-foreground">
          Agrega Läätu a tu pantalla de inicio y reserva tus clases en un toque,
          sin abrir el navegador.
        </p>

        {ios ? (
          <ol className="mt-7 space-y-4 text-sm">
            <Paso
              n="1"
              icon={<Share className="h-4 w-4" />}
              text="Toca el botón Compartir en la barra de Safari."
            />
            <Paso
              n="2"
              icon={<Plus className="h-4 w-4" />}
              text="Desliza y elige “Añadir a pantalla de inicio”."
            />
            <Paso
              n="3"
              icon={<Download className="h-4 w-4" />}
              text="Confirma con “Añadir”. Listo, ya nos tienes contigo."
            />
          </ol>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          {deferred ? (
            <button
              onClick={() => void install()}
              className="bg-foreground px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85"
            >
              Instalar ahora
            </button>
          ) : null}
          <button
            onClick={() => close()}
            className={cn(
              "px-7 py-3.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors",
              deferred
                ? "text-muted-foreground hover:text-foreground"
                : "border border-foreground hover:bg-foreground hover:text-background",
            )}
          >
            {deferred ? "Ahora no" : "Entendido"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Paso({
  n,
  icon,
  text,
}: {
  n: string;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-border font-mono text-[0.65rem]">
        {n}
      </span>
      <span className="flex items-start gap-2 pt-2 text-muted-foreground">
        <span className="text-secondary">{icon}</span>
        {text}
      </span>
    </li>
  );
}

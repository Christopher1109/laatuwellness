import { useEffect, useState } from "react";
import { X, Share, Plus, Download } from "lucide-react";
import { cn } from "@/lib/utils";

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

/** Solo celulares y tablets: en escritorio no tiene sentido. */
function isMobileOrTablet() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const esTablet = /iPad|Tablet|PlayBook|Silk/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  const esMovil = /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const pantallaChica = window.matchMedia("(max-width: 1024px)").matches;
  const tactil = window.matchMedia("(pointer: coarse)").matches;
  return esMovil || esTablet || (pantallaChica && tactil);
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
    if (!isMobileOrTablet()) return;

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

  const close = () => setOpen(false);

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
      <div className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto border border-border bg-background p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_30px_80px_-30px_rgba(39,40,56,0.6)] sm:p-8">
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
          className="h-14 w-14 border border-border object-contain sm:h-16 sm:w-16"
        />

        <p className="eyebrow mt-6">Läätu en tu bolsillo</p>
        <h2 className="statement mt-3 text-[1.4rem] leading-tight sm:text-[1.7rem]">
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

        <div className="mt-7 grid grid-cols-1 gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
          {deferred ? (
            <button
              onClick={() => void install()}
              className="bg-foreground px-7 py-3.5 text-center text-[0.7rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85"
            >
              Instalar ahora
            </button>
          ) : null}
          <button
            onClick={() => close()}
            className={cn(
              "px-7 py-3.5 text-center text-[0.7rem] uppercase tracking-[0.18em] transition-colors",
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

import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { BrandLink, Wordmark, BirdMark } from "@/components/brand";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/nosotros", label: "Nosotros" },
  { to: "/programas", label: "Programas" },
  { to: "/coaches", label: "Coaches" },
  { to: "/horarios", label: "Horarios" },
  { to: "/contacto", label: "Contacto" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <BrandLink />

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "text-[0.78rem] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground",
                pathname === item.to && "text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <>
              {isAdmin ? (
                <Link
                  to="/admin"
                  className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
                >
                  Admin
                </Link>
              ) : null}
              <Link
                to="/cuenta"
                className="border border-foreground px-4 py-2 text-[0.72rem] uppercase tracking-[0.16em] transition-colors hover:bg-foreground hover:text-background"
              >
                Mi cuenta
              </Link>
              <button
                onClick={signOut}
                className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                Salir
              </button>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                Entrar
              </Link>
              <Link
                to="/horarios"
                className="bg-foreground px-5 py-2.5 text-[0.72rem] uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-85"
              >
                Reservar
              </Link>
            </>
          )}
        </div>

        <button
          className="md:hidden"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border bg-background md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-4">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="py-3 text-sm uppercase tracking-[0.16em] text-muted-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to={user ? "/cuenta" : "/auth"}
              onClick={() => setOpen(false)}
              className="mt-3 bg-foreground px-5 py-3 text-center text-[0.72rem] uppercase tracking-[0.16em] text-background"
            >
              {user ? "Mi cuenta" : "Entrar / Registrarte"}
            </Link>
            {user && isAdmin ? (
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="py-3 text-sm uppercase tracking-[0.16em] text-muted-foreground"
              >
                Panel admin
              </Link>
            ) : null}
            {user ? (
              <button
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
                className="py-3 text-left text-sm uppercase tracking-[0.16em] text-muted-foreground"
              >
                Salir
              </button>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="surface-dark constellation grain mt-24">
      <div className="relative z-[2] mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <Wordmark tone="ivory" className="h-9" />
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Wellness Recovery Bar. Un espacio para respirar, moverte y
              agradecer el recorrido.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
            <div>
              <p className="eyebrow">Estudio</p>
              <ul className="mt-4 space-y-2 text-muted-foreground">
                <li><Link to="/nosotros" className="hover:text-foreground">Nosotros</Link></li>
                <li><Link to="/programas" className="hover:text-foreground">Programas</Link></li>
                <li><Link to="/coaches" className="hover:text-foreground">Coaches</Link></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow">Reservar</p>
              <ul className="mt-4 space-y-2 text-muted-foreground">
                <li><Link to="/horarios" className="hover:text-foreground">Horarios</Link></li>
                <li><Link to="/cuenta" className="hover:text-foreground">Mi cuenta</Link></li>
                <li><Link to="/app" className="hover:text-foreground">App</Link></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow">Contacto</p>
              <ul className="mt-4 space-y-2 text-muted-foreground">
                <li>
                  <a href="https://instagram.com/laatu" target="_blank" rel="noreferrer" className="hover:text-foreground">
                    Instagram @laatu
                  </a>
                </li>
                <li>
                  {/* TODO: enlazar la tienda de suplementos definitiva */}
                  <a href="https://instagram.com/laatu" target="_blank" rel="noreferrer" className="hover:text-foreground">
                    Suplementos
                  </a>
                </li>
                <li>
                  <a href="mailto:lore@tuwellness.com" className="hover:text-foreground">
                    lore@tuwellness.com
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Läätu Wellness</p>
          <p className="tracking-[0.18em] uppercase">Encuentra paz en el caos</p>
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="eyebrow rise">{eyebrow}</p>
        <h1 className="statement rise mt-6 text-[clamp(2.5rem,7vw,5rem)]">{title}</h1>
        {intro ? (
          <p className="rise mt-6 max-w-xl text-base text-muted-foreground">{intro}</p>
        ) : null}
      </div>
    </section>
  );
}

import { useState, type ReactNode } from "react";
import { Menu, X, LogOut } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type AdminNavItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export type AdminNavGroup = {
  label?: string;
  items: AdminNavItem[];
};

export function AdminShell({
  groups,
  active,
  onSelect,
  title,
  subtitle,
  children,
}: {
  groups: AdminNavGroup[];
  active: string;
  onSelect: (key: string) => void;
  title: string;
  subtitle?: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const activeLabel = groups.flatMap((g) => g.items).find((i) => i.key === active)?.label ?? title;

  const Nav = (
    <nav className="flex h-full flex-col">
      <div className="px-6 py-7">
        <Wordmark tone="ivory" variant="stack" className="h-10" />
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label ? (
              <p className="px-3 pb-2 text-[0.65rem] uppercase tracking-[0.18em] text-ivory/40">
                {g.label}
              </p>
            ) : null}
            <ul className="space-y-1">
              {g.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === active;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => {
                        onSelect(item.key);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        isActive
                          ? "bg-ivory text-shadow"
                          : "text-ivory/70 hover:bg-white/5 hover:text-ivory",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-3 py-4">
        <button
          onClick={() => supabase.auth.signOut().then(() => window.location.assign("/auth"))}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-ivory/70 hover:bg-white/5 hover:text-ivory"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </nav>
  );

  return (
    <div className="fixed inset-0 flex bg-background text-foreground">
      {/* sidebar — desktop */}
      <aside className="surface-dark hidden w-64 shrink-0 lg:block">{Nav}</aside>

      {/* sidebar — mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="surface-dark absolute inset-y-0 left-0 w-72">{Nav}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-border px-5 py-4 lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <p className="eyebrow">{subtitle ?? "Panel del estudio"}</p>
            <h1 className="text-lg font-medium">{activeLabel}</h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-5 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

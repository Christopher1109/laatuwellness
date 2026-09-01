import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ShoppingCart, Users, ClipboardCheck, ArrowLeft, LogOut } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { POSPanel, ClientsPanel, CheckInPanel } from "@/components/admin/ops-panels";
import { AdminSchedulePanel } from "@/components/admin/schedule-calendar";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({
    meta: [
      { title: "Panel de staff — Läätu Wellness" },
      { name: "description", content: "Punto de venta, reservaciones y check-in para el equipo." },
    ],
  }),
  component: StaffPanel,
});

const CLASS_MODULES = ["reformer", "4mat", "contraste"] as const;

type ButtonKey = "pos" | "reservaciones" | "checkin";

const BUTTONS: { key: ButtonKey; label: string; icon: typeof ShoppingCart }[] = [
  { key: "pos", label: "Punto de venta", icon: ShoppingCart },
  { key: "reservaciones", label: "Reservaciones y créditos", icon: Users },
  { key: "checkin", label: "Check-in", icon: ClipboardCheck },
];

function StaffPanel() {
  const { isStaff, isAdmin, loading, staffProfile } = useAuth();
  const [active, setActive] = useState<ButtonKey | null>(null);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Cargando…</div>;
  }

  if (!isStaff && !isAdmin) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 text-center">
        <h1 className="statement text-3xl">Acceso restringido</h1>
        <p className="mt-4 text-muted-foreground">
          Esta sección es solo para el equipo del estudio.
        </p>
      </div>
    );
  }

  const activeLabel = BUTTONS.find((b) => b.key === active)?.label;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-5">
        <div className="flex items-center gap-4">
          {active ? (
            <button
              type="button"
              onClick={() => setActive(null)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
              Menú
            </button>
          ) : (
            <Wordmark variant="stack" className="h-9" />
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {activeLabel ?? staffProfile?.full_name ?? "Staff"}
          </span>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Salir
          </button>
        </div>
      </header>

      {active === null ? (
        <div className="mx-auto grid max-w-4xl gap-6 px-6 py-16 sm:grid-cols-3">
          {BUTTONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className="flex flex-col items-center justify-center gap-4 border border-border bg-background p-10 text-center transition-colors hover:border-foreground hover:bg-muted"
            >
              <Icon className="h-10 w-10" />
              <span className="text-lg">{label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          {active === "pos" ? <POSPanel /> : null}
          {active === "reservaciones" ? (
            <div className="space-y-10">
              <ClientsPanel />
              <AdminSchedulePanel
                modules={[...CLASS_MODULES]}
                title="Reservar clase para un cliente"
              />
            </div>
          ) : null}
          {active === "checkin" ? <CheckInPanel /> : null}
        </div>
      )}
    </div>
  );
}

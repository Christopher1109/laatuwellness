import { CreditLotsSummary } from "@/components/credit-lots";
import { MembershipStatusCard, useMembershipStatus } from "@/components/membership-status";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, ListChecks, LogOut, ShoppingBag, Wallet } from "lucide-react";
import { Schedule } from "@/components/schedule";
import { PlanCatalog } from "@/components/plan-catalog";
import { Wordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { PlanCheckoutModal, type CheckoutPlan } from "@/components/payments/plan-checkout-modal";
import { CouponRedeemBox } from "@/components/coupon-redeem";
import { createMerchCartClipCheckout } from "@/utils/clip.functions";
import { useAuth } from "@/hooks/useAuth";
import { rememberPostAuthRoute, useStandalone } from "@/hooks/use-standalone";
import { cn } from "@/lib/utils";
import { appTeamDestination } from "@/lib/app-team-navigation";
import { tryChargePendingNoShowFee } from "@/utils/membership-fee";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "App — Läätu Wellness" },
      {
        name: "description",
        content:
          "Reserva tus clases, revisa tu lista de espera y tus créditos desde la app de Läätu.",
      },
      { property: "og:title", content: "App — Läätu Wellness" },
      {
        property: "og:description",
        content: "Tu cuenta y el panel del estudio en la app de Läätu Wellness.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppShell,
});

function money(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

type Tab = "horarios" | "reservas" | "creditos" | "tienda";

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: "horarios", label: "Horarios", icon: CalendarDays },
  { key: "reservas", label: "Reservas", icon: ListChecks },
  { key: "creditos", label: "Créditos", icon: Wallet },
  { key: "tienda", label: "Tienda", icon: ShoppingBag },
];

function AppShell() {
  const { user, loading, rolesLoading, isAdmin, isStaff, isCoach } = useAuth();
  const [tab, setTab] = useState<Tab>("horarios");

  if (loading || rolesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  if (!user) return <AppLoginGate />;

  const teamDestination = appTeamDestination({ isAdmin, isStaff, isCoach });
  if (teamDestination) return <Navigate to={teamDestination} replace />;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppTopBar />
      <main className="flex-1 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {tab === "horarios" ? <HorariosTab /> : null}
        {tab === "reservas" ? <ReservasTab onGoToSchedule={() => setTab("horarios")} /> : null}
        {tab === "creditos" ? <CreditosTab /> : null}
        {tab === "tienda" ? <TiendaTab /> : null}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-stretch">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-[0.62rem] uppercase tracking-[0.1em] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.6} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function AppLoginGate() {
  const navigate = useNavigate();
  const standalone = useStandalone();

  // Desde el acceso directo instalado no preguntamos nada: la sesión se
  // guarda en el dispositivo y, si expiró, vamos directo a iniciar sesión.
  useEffect(() => {
    if (!standalone) return;
    rememberPostAuthRoute("/app");
    navigate({ to: "/auth", replace: true });
  }, [standalone, navigate]);

  if (standalone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-foreground text-background">
        <p className="text-sm text-background/70">Abriendo tu cuenta…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-foreground px-6 text-center text-background">
      <Wordmark tone="ivory" className="h-10" />
      <p className="mt-8 max-w-xs text-sm text-background/70">
        Reserva tus clases, revisa tu lista de espera y tus créditos desde aquí.
      </p>
      <Link
        to="/auth"
        className="mt-8 w-full max-w-xs bg-background px-6 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-foreground"
      >
        Entrar o crear cuenta
      </Link>
      <Link to="/" className="mt-6 text-[0.68rem] uppercase tracking-[0.16em] text-background/60">
        Ver la página
      </Link>
    </div>
  );
}

function AppTopBar() {
  const { user } = useAuth();

  const { data: balance } = useQuery({
    queryKey: ["app-balance", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("token_balance", { _user_id: user!.id });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["app-profile", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: membership } = useMembershipStatus(user?.id);
  const firstName = (profile?.full_name || "").split(" ")[0];

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-md">
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
          {firstName ? `Hola, ${firstName}` : "Läätu"}
        </p>
        <p className="text-lg leading-none">
          {membership ? `${membership.plan_name} · ` : ""}
          {balance ?? 0} créditos
        </p>
      </div>
      <button
        onClick={signOut}
        aria-label="Cerrar sesión"
        className="text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-5 w-5" />
      </button>
    </header>
  );
}

/**
 * Horarios en la app: los mismos bloques por programa que la página web
 * (Reformer, 4mat, DorisFisio…), leídos de la misma tabla de clases, así que
 * cualquier ajuste del panel se ve igual en la web y en la app.
 */
function HorariosTab() {
  return (
    <div className="px-5 py-5">
      <Schedule defaultRange="semana" />
    </div>
  );
}

type AppBooking = {
  id: string;
  status: string;
  seat_number: number | null;
  tokens_spent: number;
  classes: {
    starts_at: string;
    duration_min: number;
    room: string;
    instructor: string;
    module_key: string | null;
    class_type_id: string | null;
    is_tbd: boolean;
  } | null;
};

const MODULE_NAMES: Record<string, string> = {
  reformer: "Reformer",
  "4mat": "4mat",
  rehabilitacion: "DorisFisio",
  contraste: "Contrast Therapy",
};

const mtyTime = (d: Date) =>
  new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

function relativeDay(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/** Qué pasa si cancela ahora, según la política del estudio. */
function cancelPolicy(startsAt: Date, tokensSpent: number) {
  const hours = (startsAt.getTime() - Date.now()) / 3600000;
  if (hours >= 12) {
    return tokensSpent > 0
      ? "Faltan más de 12 horas: se te regresa tu crédito."
      : "Faltan más de 12 horas: puedes cancelar sin problema.";
  }
  if (hours < 2) {
    return "Faltan menos de 2 horas: el crédito no se regresa y, si tienes membresía, se aplica un cargo de $150.";
  }
  return "Faltan menos de 12 horas: el crédito ya no se regresa.";
}

function ReservasTab({ onGoToSchedule }: { onGoToSchedule: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<"proximas" | "espera" | "historial">("proximas");
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["app-bookings", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, status, seat_number, tokens_spent, classes(starts_at, duration_min, room, instructor, module_key, class_type_id, is_tbd)",
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as AppBooking[];
    },
  });

  const { data: typeNames } = useQuery({
    queryKey: ["public-class-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_types")
        .select("id, name")
        .eq("active", true);
      if (error) throw error;
      return new Map((data ?? []).map((t) => [t.id, t.name]));
    },
  });

  const refresh = () => {
    for (const key of [
      "app-bookings",
      "app-balance",
      "classes",
      "my-bookings",
      "membership-status",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("cancel_booking", { _booking_id: bookingId });
      if (error) throw error;
      await tryChargePendingNoShowFee(bookingId);
    },
    onSuccess: () => {
      toast.success("Reserva cancelada.");
      setConfirming(null);
      refresh();
    },
    onError: () => toast.error("No pudimos cancelar. Intenta de nuevo o escríbenos."),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("leave_waitlist", { _booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saliste de la lista de espera. Se te regresó tu crédito.");
      setConfirming(null);
      refresh();
    },
    onError: () => toast.error("No se pudo salir de la lista de espera."),
  });

  const now = Date.now();
  const withClass = (bookings ?? []).filter((b) => b.classes);
  const startOf = (b: AppBooking) => new Date(b.classes!.starts_at);
  const upcoming = withClass
    .filter((b) => b.status === "reservada" && startOf(b).getTime() > now)
    .sort((a, b) => startOf(a).getTime() - startOf(b).getTime());
  const waitlisted = withClass
    .filter((b) => b.status === "lista_espera" && startOf(b).getTime() > now)
    .sort((a, b) => startOf(a).getTime() - startOf(b).getTime());
  const past = withClass
    .filter(
      (b) =>
        (b.status !== "reservada" && b.status !== "lista_espera") || startOf(b).getTime() <= now,
    )
    .sort((a, b) => startOf(b).getTime() - startOf(a).getTime());

  const className = (b: AppBooking) =>
    (b.classes!.class_type_id ? typeNames?.get(b.classes!.class_type_id) : undefined) ??
    MODULE_NAMES[b.classes!.module_key ?? ""] ??
    b.classes!.room;
  const coachName = (b: AppBooking) =>
    b.classes!.is_tbd ? "Coach por anunciar" : b.classes!.instructor || "";

  const segments = [
    ["proximas", "Próximas", upcoming.length],
    ["espera", "En espera", waitlisted.length],
    ["historial", "Historial", past.length],
  ] as const;

  const card = (b: AppBooking, kind: "proxima" | "espera" | "pasada", highlight = false) => {
    const start = startOf(b);
    const end = new Date(start.getTime() + b.classes!.duration_min * 60000);
    const isConfirming = confirming === b.id;
    const pastLabel =
      b.status === "cancelada" ? "Cancelada" : b.status === "lista_espera" ? "Sin lugar" : "Tomada";
    return (
      <li
        key={b.id}
        className={cn(
          "overflow-hidden rounded-xl border bg-background",
          highlight ? "border-foreground shadow-md" : "border-border",
          kind === "pasada" && "opacity-75",
        )}
      >
        <div className="flex gap-4 p-4">
          <div
            className={cn(
              "flex w-14 shrink-0 flex-col items-center justify-center rounded-lg py-2",
              highlight ? "bg-foreground text-background" : "bg-muted",
            )}
          >
            <span className="text-[0.6rem] uppercase tracking-[0.12em]">
              {new Intl.DateTimeFormat("es-MX", { weekday: "short" })
                .format(start)
                .replace(".", "")}
            </span>
            <span className="text-xl leading-tight">{start.getDate()}</span>
            <span className="text-[0.6rem] uppercase tracking-[0.12em]">
              {new Intl.DateTimeFormat("es-MX", { month: "short" }).format(start).replace(".", "")}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
              {kind === "pasada" ? relativeDay(start) : relativeDay(start)} · {mtyTime(start)}–
              {mtyTime(end)}
            </p>
            <p className="mt-0.5 truncate text-base font-medium">{className(b)}</p>
            <p className="truncate text-sm text-muted-foreground">
              {[coachName(b), b.classes!.room].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {kind === "proxima" && b.seat_number ? (
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[0.62rem] text-background">
                  Lugar {b.seat_number}
                </span>
              ) : null}
              {kind === "espera" ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.62rem] text-amber-800">
                  En lista de espera
                </span>
              ) : null}
              {kind === "pasada" ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.62rem]",
                    b.status === "cancelada"
                      ? "bg-muted text-muted-foreground"
                      : "bg-emerald-500/10 text-emerald-700",
                  )}
                >
                  {pastLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {kind !== "pasada" ? (
          isConfirming ? (
            <div className="border-t border-border bg-muted/40 p-4">
              <p className="text-sm">
                {kind === "espera"
                  ? "¿Salir de la lista de espera? Se te regresa tu crédito."
                  : `¿Cancelar tu clase? ${cancelPolicy(start, b.tokens_spent)}`}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="border border-input bg-background px-3 py-2.5 text-[0.65rem] uppercase tracking-[0.14em]"
                >
                  No, mantener
                </button>
                <button
                  type="button"
                  disabled={cancel.isPending || leaveWaitlist.isPending}
                  onClick={() =>
                    kind === "espera" ? leaveWaitlist.mutate(b.id) : cancel.mutate(b.id)
                  }
                  className="bg-foreground px-3 py-2.5 text-[0.65rem] uppercase tracking-[0.14em] text-background disabled:opacity-50"
                >
                  {kind === "espera" ? "Sí, salir" : "Sí, cancelar"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(b.id)}
              className="w-full border-t border-border py-3 text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
            >
              {kind === "espera" ? "Salir de la lista de espera" : "Cancelar reserva"}
            </button>
          )
        ) : null}
      </li>
    );
  };

  const list = view === "proximas" ? upcoming : view === "espera" ? waitlisted : past.slice(0, 40);

  return (
    <div className="px-5 py-6">
      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
        {segments.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setView(key);
              setConfirming(null);
            }}
            className={cn(
              "rounded-full px-2 py-2 text-[0.64rem] uppercase tracking-[0.1em] transition-colors",
              view === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
            {count > 0 && key !== "historial" ? ` (${count})` : ""}
          </button>
        ))}
      </div>

      {isLoading ? <p className="mt-8 text-sm text-muted-foreground">Cargando…</p> : null}

      {!isLoading && list.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <CalendarDays className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">
            {view === "proximas"
              ? "No tienes clases reservadas"
              : view === "espera"
                ? "No estás en ninguna lista de espera"
                : "Aún no tienes historial"}
          </p>
          {view !== "historial" ? (
            <button
              type="button"
              onClick={onGoToSchedule}
              className="mt-2 bg-foreground px-5 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background"
            >
              Ver horarios
            </button>
          ) : null}
        </div>
      ) : null}

      {list.length > 0 ? (
        <>
          {view === "proximas" ? (
            <p className="mb-3 mt-6 eyebrow">Tu próxima clase</p>
          ) : (
            <div className="mt-6" />
          )}
          <ul className="space-y-3">
            {list.map((b, i) =>
              card(
                b,
                view === "proximas" ? "proxima" : view === "espera" ? "espera" : "pasada",
                view === "proximas" && i === 0,
              ),
            )}
          </ul>
          {view === "proximas" ? (
            <p className="mt-6 text-xs text-muted-foreground">
              Puedes cancelar hasta 12 horas antes para recuperar tu crédito.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function CreditosTab() {
  const { user } = useAuth();
  const [buying, setBuying] = useState<CheckoutPlan | null>(null);

  const { data: balance } = useQuery({
    queryKey: ["app-balance", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("token_balance", { _user_id: user!.id });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ["app-transactions", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, token_plans(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const { data: membership } = useMembershipStatus(user?.id);

  return (
    <div className="px-5 py-6">
      <p className="eyebrow">Tu saldo</p>
      <div className="mt-3 space-y-3">
        {membership ? <MembershipStatusCard userId={user?.id} user={user} /> : null}
        {(balance ?? 0) > 0 ? (
          <CreditLotsSummary userId={user?.id} />
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-border p-5">
            <div>
              <p className="eyebrow">Créditos de paquetes</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {membership ? "Tu membresía no usa créditos." : "Compra un paquete para reservar."}
              </p>
            </div>
            <p className="text-3xl">0</p>
          </div>
        )}
      </div>

      <div className="mt-10">
        <p className="eyebrow mb-4">Comprar paquetes y membresías</p>
        <PlanCatalog variant="app" onBuy={(p) => setBuying(p as unknown as CheckoutPlan)} />
      </div>

      <CouponRedeemBox className="mt-10" />

      <div className="mt-10">
        <p className="eyebrow">Compras recientes</p>
        {(transactions ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Sin compras registradas.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {(transactions ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{t.token_plans?.name ?? "Paquete"}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                      new Date(t.created_at),
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {money(t.amount_cents, t.currency)}
                  {t.tokens > 0 ? ` · +${t.tokens}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {buying ? (
        <PlanCheckoutModal plan={buying} user={user} onClose={() => setBuying(null)} />
      ) : null}
    </div>
  );
}

const STORE_CATEGORY_LABELS: Record<string, string> = {
  merch: "Merch",
};

function TiendaTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["app-store-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      // brand no está en los tipos generados todavía; se filtra aquí en vez
      // de en la consulta SQL para no perder el tipado del resto.
      // Los consumibles (bebidas, smoothies, café, barras) solo se venden en
      // el punto de venta del estudio, no en la app.
      return (data ?? []).filter(
        (p) =>
          (p as unknown as { brand?: string }).brand !== "goodes" && p.category !== "consumible",
      );
    },
  });

  const { data: myOrders } = useQuery({
    queryKey: ["app-my-orders", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data: sales, error } = await supabase
        .from("pos_sales")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const saleIds = (sales ?? []).map((s) => s.id);
      const { data: items } = saleIds.length
        ? await supabase.from("pos_sale_items").select("*").in("sale_id", saleIds)
        : { data: [] as { sale_id: string; description: string; qty: number }[] };
      return (sales ?? []).map((s) => ({
        ...s,
        items: (items ?? []).filter((i) => i.sale_id === s.id),
      }));
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof products>>();
    for (const p of products ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return Array.from(groups.entries());
  }, [products]);

  const total = useMemo(() => {
    if (!products) return 0;
    return Object.entries(cart).reduce((sum, [id, qty]) => {
      const p = products.find((p) => p.id === id);
      return sum + (p ? p.price_cents * qty : 0);
    }, 0);
  }, [cart, products]);

  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const statusLabel: Record<string, string> = {
    pendiente: "Pendiente",
    listo: "Listo para recoger",
    entregado: "Entregado",
  };

  return (
    <div className="space-y-10 px-5 py-6">
      <p className="text-center text-lg">Featured items</p>
      {grouped.map(([category, items]) => (
        <div key={category}>
          <p className="eyebrow">{STORE_CATEGORY_LABELS[category] ?? category}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {items.map((p) => (
              <div key={p.id} className="border border-border">
                <div className="flex aspect-square items-center justify-center bg-muted">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{money(p.price_cents)}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      onClick={() =>
                        setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))
                      }
                      className="border border-input px-2.5 py-1 text-sm"
                    >
                      −
                    </button>
                    <span className="text-sm">{cart[p.id] ?? 0}</span>
                    <button
                      onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}
                      className="border border-input px-2.5 py-1 text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin productos publicados.</p>
      ) : null}

      {itemCount > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+max(0.5rem,env(safe-area-inset-bottom)))] z-30 border-t border-border bg-background p-4">
          <button
            onClick={() => setConfirming(true)}
            className="flex w-full items-center justify-between bg-foreground px-5 py-3 text-[0.7rem] uppercase tracking-[0.16em] text-background"
          >
            <span>
              {itemCount} producto{itemCount === 1 ? "" : "s"}
            </span>
            <span>{money(total)}</span>
          </button>
        </div>
      ) : null}

      <div>
        <p className="eyebrow">Mis pedidos recientes</p>
        <ul className="mt-3 divide-y divide-border">
          {(myOrders ?? []).map((o) => (
            <li key={o.id} className="py-3">
              <div className="flex items-center justify-between text-sm">
                <span>{o.items.map((i) => `${i.qty}× ${i.description}`).join(", ")}</span>
                <span className="text-xs text-muted-foreground">{money(o.total_cents)}</span>
              </div>
              <span
                className={cn(
                  "mt-1 inline-block px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em]",
                  o.status === "entregado"
                    ? "bg-muted text-muted-foreground"
                    : o.status === "listo"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-amber-500/10 text-amber-700",
                )}
              >
                {statusLabel[o.status] ?? o.status}
              </span>
              {(o as unknown as { order_code?: string }).order_code ? (
                <span className="ml-2 font-mono text-[0.6rem] text-muted-foreground">
                  {(o as unknown as { order_code?: string }).order_code}
                </span>
              ) : null}
            </li>
          ))}
          {(myOrders ?? []).length === 0 ? (
            <li className="py-3 text-sm text-muted-foreground">Sin pedidos todavía.</li>
          ) : null}
        </ul>
      </div>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]"
          onClick={() => !paying && setConfirming(false)}
        >
          <div className="w-full max-w-sm bg-background p-6" onClick={(e) => e.stopPropagation()}>
            {!paying ? (
              <>
                <p className="eyebrow">Confirmar pedido</p>
                <ul className="mt-3 space-y-1 text-sm">
                  {Object.entries(cart)
                    .filter(([, qty]) => qty > 0)
                    .map(([id, qty]) => {
                      const p = products?.find((p) => p.id === id);
                      return (
                        <li key={id} className="flex justify-between">
                          <span>
                            {qty}× {p?.name}
                          </span>
                          <span>{money((p?.price_cents ?? 0) * qty)}</span>
                        </li>
                      );
                    })}
                </ul>
                <div className="mt-3 flex justify-between border-t border-border pt-3 text-lg">
                  <span>Total</span>
                  <span>{money(total)}</span>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Se paga en línea ahora. Recoges tu pedido en el estudio — te avisamos cuando esté
                  listo.
                </p>
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={() => setConfirming(false)}
                    className="flex-1 border border-input px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em]"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={async () => {
                      if (!user?.id) return;
                      setPaying(true);
                      const items = Object.entries(cart)
                        .filter(([, qty]) => qty > 0)
                        .map(([id, qty]) => {
                          const p = products?.find((p) => p.id === id)!;
                          return {
                            productId: p.id,
                            productName: p.name,
                            priceCents: p.price_cents,
                            qty,
                          };
                        });
                      try {
                        const result = await createMerchCartClipCheckout({
                          data: { items, origin: window.location.origin },
                        });
                        if (result.paymentUrl) {
                          window.location.href = result.paymentUrl;
                        } else {
                          throw new Error("Clip no devolvió un link de pago.");
                        }
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "No se pudo iniciar el pago.",
                        );
                        setPaying(false);
                      }
                    }}
                    disabled={paying}
                    className="flex-1 bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
                  >
                    {paying ? "Preparando…" : "Pagar"}
                  </button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Redirigiendo a Clip…
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

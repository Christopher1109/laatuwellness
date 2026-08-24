import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, ListChecks, Wallet, LogOut, ShoppingBag } from "lucide-react";
import { Schedule } from "@/components/schedule";
import { Wordmark } from "@/components/brand";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "App — Läätu Wellness" },
      {
        name: "description",
        content:
          "Reserva tus clases, revisa tu lista de espera y tus créditos desde la app de Läätu.",
      },
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

function dateTime(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

type Tab = "horarios" | "reservas" | "creditos" | "tienda";

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: "horarios", label: "Horarios", icon: CalendarDays },
  { key: "reservas", label: "Reservas", icon: ListChecks },
  { key: "creditos", label: "Créditos", icon: Wallet },
  { key: "tienda", label: "Tienda", icon: ShoppingBag },
];

function AppShell() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("horarios");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  if (!user) return <AppLoginGate />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppTopBar />
      <main className="flex-1 pb-24">
        {tab === "horarios" ? <HorariosTab /> : null}
        {tab === "reservas" ? <ReservasTab /> : null}
        {tab === "creditos" ? <CreditosTab /> : null}
        {tab === "tienda" ? <TiendaTab /> : null}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-md">
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
      <WhatsAppButton />
    </div>
  );
}

function AppLoginGate() {
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

  const firstName = (profile?.full_name || "").split(" ")[0];

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-5 py-4 backdrop-blur-md">
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
          {firstName ? `Hola, ${firstName}` : "Läätu"}
        </p>
        <p className="text-lg leading-none">{balance ?? 0} créditos</p>
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

function HorariosTab() {
  return (
    <div className="px-5 py-6">
      <Schedule defaultRange="hoy" />
    </div>
  );
}

function ReservasTab() {
  const { user } = useAuth();

  const { data: bookings } = useQuery({
    queryKey: ["app-bookings", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, classes(room, instructor, starts_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("cancel_booking", { _booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reserva cancelada.");
      void qc.invalidateQueries({ queryKey: ["app-bookings"] });
    },
    onError: () => toast.error("No pudimos cancelar."),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("leave_waitlist", { _booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saliste de la lista de espera.");
      void qc.invalidateQueries({ queryKey: ["app-bookings"] });
    },
    onError: () => toast.error("No se pudo salir de la lista de espera."),
  });

  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) => b.status === "reservada" && new Date(b.classes!.starts_at).getTime() > now,
  );
  const waitlisted = (bookings ?? []).filter(
    (b) => b.status === "lista_espera" && new Date(b.classes!.starts_at).getTime() > now,
  );
  const past = (bookings ?? []).filter(
    (b) =>
      (b.status !== "reservada" && b.status !== "lista_espera") ||
      new Date(b.classes!.starts_at).getTime() <= now,
  );

  return (
    <div className="space-y-10 px-5 py-6">
      <div>
        <p className="eyebrow">Próximas</p>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aún no tienes reservas.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm">
                    {dateTime(b.classes!.starts_at)}
                    {b.seat_number ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[0.55rem] text-background">
                        {b.seat_number}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.classes!.room} · {b.classes!.instructor}
                  </p>
                </div>
                <button
                  onClick={() => cancel.mutate(b.id)}
                  className="shrink-0 border border-input px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.14em]"
                >
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {waitlisted.length > 0 ? (
        <div>
          <p className="eyebrow">Lista de espera</p>
          <ul className="mt-3 divide-y divide-border">
            {waitlisted.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm">{dateTime(b.classes!.starts_at)}</p>
                  <p className="truncate text-xs text-amber-600">Crédito apartado</p>
                </div>
                <button
                  onClick={() => leaveWaitlist.mutate(b.id)}
                  className="shrink-0 border border-input px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.14em]"
                >
                  Salir
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="eyebrow">Historial</p>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aún sin historial.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {past.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="text-muted-foreground">{dateTime(b.classes!.starts_at)}</span>
                <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Class Packages",
  membresia: "Membresías",
  consulta: "Align — DorisFisio",
  recuperacion: "Contrast",
};
const CATEGORY_ORDER = ["clases_pilates", "membresia", "consulta", "recuperacion"];

function CreditosTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [buying, setBuying] = useState<{
    id: string;
    name: string;
    price: number;
    tokens: number;
  } | null>(null);

  const { data: balance } = useQuery({
    queryKey: ["app-balance", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("token_balance", { _user_id: user!.id });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["app-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_plans")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
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

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof plans>>();
    for (const p of plans ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!] as const);
  }, [plans]);

  const purchase = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc("purchase_plan", {
        _plan_id: planId,
        _payment_method: "pendiente",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Créditos acreditados.");
      setBuying(null);
      void qc.invalidateQueries({ queryKey: ["app-balance"] });
      void qc.invalidateQueries({ queryKey: ["app-transactions"] });
    },
    onError: () => toast.error("No pudimos completar la compra."),
  });

  return (
    <div className="space-y-10 px-5 py-6">
      <div className="border border-border p-6 text-center">
        <p className="eyebrow">Créditos disponibles</p>
        <p className="mt-2 text-4xl">{balance ?? 0}</p>
      </div>

      <div className="space-y-8">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <p className="eyebrow">{CATEGORY_LABELS[category] ?? category}</p>
            <div className="mt-3 space-y-2">
              {items.map((p) => (
                <div key={p.id} className="border border-border p-4">
                  <p className="text-sm">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {money(p.price_cents, p.currency)} · {p.tokens} créditos
                    {p.recurring ? " · recurrente" : ""}
                  </p>
                  <button
                    onClick={() =>
                      setBuying({ id: p.id, name: p.name, price: p.price_cents, tokens: p.tokens })
                    }
                    className="mt-3 w-full border border-foreground px-4 py-2 text-[0.62rem] uppercase tracking-[0.14em]"
                  >
                    Comprar
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        <p className="eyebrow">Compras recientes</p>
        {(transactions ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Sin compras registradas.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {(transactions ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>{t.token_plans?.name ?? "Paquete"}</span>
                <span className="text-xs text-muted-foreground">
                  {money(t.amount_cents, t.currency)} · +{t.tokens}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {buying ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBuying(null)}
        >
          <div
            className="w-full max-w-sm bg-background p-8 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="eyebrow">Pago seguro</p>
            <h3 className="mt-3 text-xl">Estamos integrando tu pago</h3>
            <p className="mt-4 text-sm text-muted-foreground">
              Muy pronto vas a poder pagar <strong>{buying.name}</strong> ({money(buying.price)})
              con tarjeta directo aquí, vía Stripe. Mientras tanto, tu compra queda registrada y tus{" "}
              {buying.tokens} créditos se acreditan de inmediato.
            </p>
            <div className="mt-7 flex gap-2">
              <button
                onClick={() => setBuying(null)}
                className="flex-1 border border-input px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em]"
              >
                Cancelar
              </button>
              <button
                disabled={purchase.isPending}
                onClick={() => purchase.mutate(buying.id)}
                className="flex-1 bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
              >
                {purchase.isPending ? "Procesando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const STORE_CATEGORY_LABELS: Record<string, string> = {
  merch: "Merch",
  consumible: "Recovery Bar",
};

function TiendaTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);

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
      return data;
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

  const placeOrder = useMutation({
    mutationFn: async () => {
      const items = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({ product_id: id, qty }));
      if (items.length === 0) throw new Error("Agrega al menos un producto.");
      const { error } = await supabase.rpc("client_place_order", { _items: items });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido enviado — págalo al recogerlo en el estudio.");
      setCart({});
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["app-my-orders"] });
    },
    onError: () => toast.error("No se pudo enviar el pedido."),
  });

  const statusLabel: Record<string, string> = {
    pendiente: "Pendiente",
    listo: "Listo para recoger",
    entregado: "Entregado",
  };

  return (
    <div className="space-y-10 px-5 py-6">
      {grouped.map(([category, items]) => (
        <div key={category}>
          <p className="eyebrow">{STORE_CATEGORY_LABELS[category] ?? category}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {items.map((p) => (
              <div key={p.id} className="border border-border p-3">
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
            ))}
          </div>
        </div>
      ))}
      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin productos publicados.</p>
      ) : null}

      {itemCount > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background p-4">
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
            </li>
          ))}
          {(myOrders ?? []).length === 0 ? (
            <li className="py-3 text-sm text-muted-foreground">Sin pedidos todavía.</li>
          ) : null}
        </ul>
      </div>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirming(false)}
        >
          <div className="w-full max-w-sm bg-background p-6" onClick={(e) => e.stopPropagation()}>
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
              Se paga al recogerlo en el estudio (tarjeta o efectivo). Los pagos en línea llegan
              pronto con Stripe.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 border border-input px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em]"
              >
                Cancelar
              </button>
              <button
                disabled={placeOrder.isPending}
                onClick={() => placeOrder.mutate()}
                className="flex-1 bg-foreground px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
              >
                {placeOrder.isPending ? "Enviando…" : "Enviar pedido"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

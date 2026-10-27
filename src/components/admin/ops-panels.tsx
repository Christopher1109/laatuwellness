import { ProfilePlanCheckout } from "@/components/admin/profile-plan-checkout";
import { PasswordResetControl } from "@/components/admin/password-reset";
import { groupClientPurchases, matchesClientPurchaseFilter } from "@/lib/client-purchases";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreditLotsSummary } from "@/components/credit-lots";
import { MembershipStatusCard } from "@/components/membership-status";
import { isPlanInSaleWindow } from "@/lib/plan-availability";
import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  ClipboardCheck,
  FileSpreadsheet,
  Mail,
  Pencil,
  Phone,
  Receipt,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Users,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { deleteClient, updateClientProfile } from "@/utils/client-admin.functions";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { tryChargePendingNoShowFee } from "@/utils/membership-fee";
import { SignaturePad } from "@/components/signature-pad";
import { describeError } from "@/lib/describe-error";
import { downloadIncomeReport } from "@/lib/finance-report";
import { PAYMENT_LABELS } from "@/lib/finance-workbook";
import { refundTerminalPayment } from "@/utils/pos-refunds.functions";
import {
  cancelTerminalPayment,
  checkTerminalPayment,
  reconcileTerminalPayments,
  startTerminalPayment,
  type TerminalPaymentState,
} from "@/utils/pos-terminal.functions";

export const input =
  "w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground";

// Popout genérico reutilizado por Paquetes, Nómina y Finanzas.
export function Popout({
  onClose,
  children,
  wide,
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="admin-detail fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={`max-h-[calc(100dvh-2rem)] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto overscroll-contain bg-background p-5 sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Tabla tipo Excel: encabezados clicables que ordenan asc/desc. `columns`
// define qué campos son numéricos (para alinear a la derecha) y cómo se
// formatean.
function SortableTable<T extends Record<string, unknown>>({
  rows,
  columns,
  emptyLabel,
}: {
  rows: T[];
  columns: { key: keyof T; label: string; align?: "right"; format?: (v: unknown) => string }[];
  emptyLabel: string;
}) {
  const [sortKey, setSortKey] = useState<keyof T>(columns[0]!.key);
  const [dir, setDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sortKey, dir]);

  const toggleSort = (key: keyof T) => {
    if (key === sortKey) setDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    else {
      setSortKey(key);
      setDir(-1);
    }
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {columns.map((col) => (
            <th
              key={String(col.key)}
              onClick={() => toggleSort(col.key)}
              className={`cursor-pointer select-none py-2 text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground ${col.align === "right" ? "text-right" : "text-left"}`}
            >
              {col.label} {sortKey === col.key ? (dir === 1 ? "▲" : "▼") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {sorted.map((row, i) => (
          <tr key={i} className="hover:bg-muted/50">
            {columns.map((col) => (
              <td
                key={String(col.key)}
                className={`py-2 ${col.align === "right" ? "text-right text-muted-foreground" : ""}`}
              >
                {col.format ? col.format(row[col.key]) : String(row[col.key])}
              </td>
            ))}
          </tr>
        ))}
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="py-4 text-center text-muted-foreground">
              {emptyLabel}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format((cents ?? 0) / 100);

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const UNITS = ["pieza", "caja", "kg", "g", "l", "ml", "dosis"];

// ============================================================================
// PUNTO DE VENTA (POS)
// ============================================================================
// ============================================================================
// PEDIDOS PENDIENTES (tienda) — pedidos que los clientes
// hacen desde la app y el staff va avanzando hasta entregarlos.
// ============================================================================
const ORDER_STATUS_FLOW: Record<string, { next: string | null; label: string }> = {
  pendiente: { next: "listo", label: "Marcar listo" },
  listo: { next: "entregado", label: "Marcar entregado" },
  entregado: { next: null, label: "Entregado" },
};

export function PendingOrdersPanel() {
  const qc = useQueryClient();
  const { staffProfile } = useAuth();
  const [filter, setFilter] = useState<"activos" | "entregados" | "todos">("activos");
  const [signingOrder, setSigningOrder] = useState<{ id: string; clientName: string } | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  // Solo merch: pedidos en línea y ventas del mostrador que incluyen merch.
  // Bebidas, cafés y demás consumibles no pasan por aquí.
  const { data: orders } = useQuery({
    queryKey: ["pending-orders"],
    queryFn: async () => {
      const { data: merch, error: merchError } = await supabase
        .from("products")
        .select("id")
        .eq("category", "merch");
      if (merchError) throw merchError;
      const merchIds = (merch ?? []).map((m) => m.id);
      if (merchIds.length === 0) return [];
      const { data: items, error: itemsError } = await supabase
        .from("pos_sale_items")
        .select("sale_id, product_id, description, qty, unit_price_cents")
        .in("product_id", merchIds)
        .limit(1000);
      if (itemsError) throw itemsError;
      const saleIds = Array.from(new Set((items ?? []).map((i) => i.sale_id)));
      if (saleIds.length === 0) return [];
      const { data: sales, error } = await supabase
        .from("pos_sales")
        .select("*")
        .in("id", saleIds)
        .neq("status", "reembolsado")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const userIds = Array.from(
        new Set((sales ?? []).map((s) => s.user_id).filter(Boolean)),
      ) as string[];
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", userIds)
        : { data: [] as { id: string; full_name: string; email: string; phone: string | null }[] };
      return (sales ?? []).map((s) => ({
        ...s,
        items: (items ?? []).filter((i) => i.sale_id === s.id),
        client: profiles?.find((p) => p.id === s.user_id),
        online: Boolean(s.order_code),
      }));
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: string }) => {
      const { error } = await supabase.from("pos_sales").update({ status: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido actualizado.");
      void qc.invalidateQueries({ queryKey: ["pending-orders"] });
    },
    onError: () => toast.error("No se pudo actualizar el pedido."),
  });

  const deliverWithWaiver = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (!signature) throw new Error("Falta la firma del cliente.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merch_pickup_waivers no está en los tipos generados todavía
      const { error: waiverError } = await (supabase.from as any)("merch_pickup_waivers").insert({
        sale_id: id,
        signature_data: signature,
        full_name: signingOrder?.clientName ?? "",
        staff_id: staffProfile?.id ?? null,
      });
      if (waiverError) throw waiverError;
      const { error } = await supabase
        .from("pos_sales")
        .update({ status: "entregado" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entregado y waiver firmado.");
      setSigningOrder(null);
      setSignature(null);
      void qc.invalidateQueries({ queryKey: ["pending-orders"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar la entrega."),
  });

  const pendingCount = (orders ?? []).filter((o) => o.status !== "entregado").length;
  const visible = (orders ?? []).filter((o) =>
    filter === "activos"
      ? o.status !== "entregado"
      : filter === "entregados"
        ? o.status === "entregado"
        : true,
  );

  return (
    <div>
      <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
        Merch por entregar: compras en línea y ventas del mostrador que quedaron pendientes. Lo
        vendido en el mostrador y entregado al momento aparece en "Entregados".
      </p>
      <div className="mb-4 flex gap-1.5">
        {(["activos", "entregados", "todos"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] ${filter === f ? "border-foreground bg-foreground text-background" : "border-input"}`}
          >
            {f === "activos"
              ? `Por entregar (${pendingCount})`
              : f === "entregados"
                ? "Entregados"
                : "Todos"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((o) => {
          const flow = ORDER_STATUS_FLOW[o.status] ?? { next: null, label: o.status };
          const clientName = o.client?.full_name || o.client?.email || "Cliente";
          const isDeliverStep = flow.next === "entregado";
          return (
            <div key={o.id} className="border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="eyebrow text-[0.6rem]">
                    {o.online ? `Compra en línea · ${o.order_code}` : "Venta en mostrador"}
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">{clientName}</p>
                  {o.client?.email ? (
                    <p className="truncate text-[0.68rem] text-muted-foreground">
                      {o.client.email}
                      {o.client.phone ? ` · ${o.client.phone}` : ""}
                    </p>
                  ) : null}
                  <p className="text-[0.65rem] text-muted-foreground">
                    {new Intl.DateTimeFormat("es-MX", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(o.created_at))}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em]",
                    o.status === "entregado"
                      ? "bg-muted text-muted-foreground"
                      : o.status === "listo"
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-amber-500/10 text-amber-700",
                  )}
                >
                  {o.status}
                </span>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {o.items.map((i, idx) => (
                  <li key={idx} className="text-sm text-foreground">
                    {i.qty} × {i.description}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">{money(o.total_cents)}</p>
              <p className="text-xs text-muted-foreground">
                {o.online || o.payment_method === "tarjeta"
                  ? "Pagado con tarjeta"
                  : o.payment_method === "transferencia"
                    ? "Pagado por transferencia"
                    : o.payment_method === "efectivo"
                      ? "Pagado en efectivo"
                      : "Pago pendiente"}
              </p>
              {flow.next ? (
                <button
                  onClick={() =>
                    isDeliverStep
                      ? setSigningOrder({ id: o.id, clientName })
                      : advance.mutate({ id: o.id, next: flow.next! })
                  }
                  disabled={advance.isPending}
                  className="mt-3 w-full bg-foreground px-3 py-2 text-[0.62rem] uppercase tracking-[0.1em] text-background disabled:opacity-50"
                >
                  {flow.label}
                </button>
              ) : null}
            </div>
          );
        })}
        {visible.length === 0 ? (
          <p className="col-span-full text-muted-foreground">
            {filter === "activos"
              ? "No hay merch pendiente de entregar."
              : "Sin pedidos en este filtro."}
          </p>
        ) : null}
      </div>

      {signingOrder ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setSigningOrder(null);
            setSignature(null);
          }}
        >
          <div className="w-full max-w-md bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Entrega de Merch</p>
            <h3 className="mt-2 text-lg">{signingOrder.clientName}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Pide al cliente que firme aquí confirmando que recibió su pedido completo.
            </p>
            <div className="mt-4">
              <SignaturePad onChange={setSignature} />
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  setSigningOrder(null);
                  setSignature(null);
                }}
                className="flex-1 border border-input px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em]"
              >
                Cancelar
              </button>
              <button
                onClick={() => deliverWithWaiver.mutate({ id: signingOrder.id })}
                disabled={!signature || deliverWithWaiver.isPending}
                className="flex-1 bg-foreground px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] text-background disabled:opacity-50"
              >
                Confirmar entrega
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type PosBrandKey = "laatu" | "goodes";
type PosPlan = {
  id: string;
  name: string;
  subtitle: string | null;
  tokens: number;
  price_cents: number;
  category: string | null;
  purchasable_once?: boolean;
  new_clients_only?: boolean;
  max_sales?: number | null;
  available_from?: string | null;
  available_until?: string | null;
  renews_plan_id?: string | null;
};
type BrandGroup = {
  brand: PosBrandKey;
  items: { id: string; qty: number }[];
  plans: { id: string; qty: number }[];
  total: number;
};

export function POSPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: products } = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Los mismos paquetes que están publicados en la página web.
  const { data: plans } = useQuery({
    queryKey: ["pos-plans"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla/función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.from as any)("token_plans")
        .select(
          "id, name, subtitle, tokens, price_cents, category, purchasable_once, new_clients_only, max_sales, available_from, available_until, renews_plan_id",
        )
        .eq("active", true)
        .order("sort_order")
        .order("price_cents");
      if (error) throw error;
      return ((data ?? []) as PosPlan[]).filter((p) => isPlanInSaleWindow(p));
    },
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return products ?? [];
    return (products ?? []).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [products, q]);
  const filteredPlans = useMemo(() => {
    if (!q) return plans ?? [];
    return (plans ?? []).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.subtitle ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [plans, q]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [planCart, setPlanCart] = useState<Record<string, number>>({});
  const [clientEmail, setClientEmail] = useState("");
  const [matchedClient, setMatchedClient] = useState<{
    id: string;
    full_name: string;
    email: string;
  } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Formas de pago: tarjeta en terminal Clip, efectivo o transferencia. La
  // transferencia siempre pide cliente y se registra al confirmar que llegó.
  const [payment, setPayment] = useState<"terminal" | "efectivo" | "transferencia">("terminal");
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  const { data: suggestions } = useQuery({
    queryKey: ["pos-client-suggestions", clientEmail.trim().toLowerCase()],
    enabled: clientEmail.trim().length > 1 && !matchedClient,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .or(`email.ilike.%${clientEmail.trim()}%,full_name.ilike.%${clientEmail.trim()}%`)
        .limit(6);
      return data ?? [];
    },
  });

  const productQty = Object.values(cart).reduce((a, b) => a + b, 0);
  const planQty = Object.values(planCart).reduce((a, b) => a + b, 0);
  const itemCount = productQty + planQty;
  const isTransfer = payment === "transferencia";
  // Merch: se pide para quién es y si se lo lleva en este momento.
  const merchQty = Object.entries(cart).reduce((acc, [id, qty]) => {
    const p = products?.find((x) => x.id === id);
    return p?.category === "merch" ? acc + qty : acc;
  }, 0);
  const hasMerch = merchQty > 0;
  const [deliverNow, setDeliverNow] = useState<boolean | null>(null);
  const needsClient = planQty > 0 || isTransfer || hasMerch;

  // Paquetes con reglas (Newcomer = una sola compra y solo clientes nuevos):
  // al elegir al cliente se revisa si todavía puede comprarlos.
  const restrictedPlanIds = useMemo(
    () =>
      Object.entries(planCart)
        .filter(([id, qty]) => {
          const p = plans?.find((x) => x.id === id);
          return (
            qty > 0 &&
            p &&
            (p.purchasable_once ||
              p.new_clients_only ||
              p.max_sales != null ||
              p.available_until != null ||
              p.available_from != null ||
              p.renews_plan_id != null)
          );
        })
        .map(([id]) => id)
        .sort(),
    [planCart, plans],
  );
  const { data: planBlocks } = useQuery({
    queryKey: ["pos-plan-blocks", matchedClient?.id, restrictedPlanIds.join(",")],
    enabled: Boolean(matchedClient) && restrictedPlanIds.length > 0,
    queryFn: async () => {
      const result: Record<string, string> = {};
      for (const planId of restrictedPlanIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
        const { data, error } = await (supabase.rpc as any)("plan_purchase_block_reason", {
          _user_id: matchedClient!.id,
          _plan_id: planId,
        });
        if (error) throw error;
        if (data) result[planId] = describeError(String(data));
      }
      return result;
    },
  });
  const planBlockMessages = Object.entries(planBlocks ?? {}).map(([id, msg]) => {
    const name = plans?.find((x) => x.id === id)?.name ?? "Paquete";
    return `${name}: ${msg}`;
  });

  // Cada marca cobra en su propia terminal Clip. Los paquetes siempre son de
  // Läätu. Si el carrito mezcla marcas, se cobra en dos pasos.
  const brandGroups = useMemo<BrandGroup[]>(() => {
    const groups = new Map<PosBrandKey, BrandGroup>();
    const group = (brand: PosBrandKey) => {
      const g = groups.get(brand) ?? { brand, items: [], plans: [], total: 0 };
      groups.set(brand, g);
      return g;
    };
    for (const [id, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const p = products?.find((p) => p.id === id) as
        (Tables<"products"> & { brand?: string }) | undefined;
      if (!p) continue;
      const g = group(p.brand === "goodes" ? "goodes" : "laatu");
      g.items.push({ id, qty });
      g.total += p.price_cents * qty;
    }
    for (const [id, qty] of Object.entries(planCart)) {
      if (qty <= 0) continue;
      const p = plans?.find((p) => p.id === id);
      if (!p) continue;
      const g = group("laatu");
      g.plans.push({ id, qty });
      g.total += p.price_cents * qty;
    }
    return (["laatu", "goodes"] as const).filter((b) => groups.has(b)).map((b) => groups.get(b)!);
  }, [cart, planCart, products, plans]);
  const total = brandGroups.reduce((s, g) => s + g.total, 0);
  const isMixedBrand = brandGroups.length > 1;
  const cartBrand = brandGroups[0]?.brand ?? "laatu";
  const usesTerminal = payment === "terminal";

  const resetSale = () => {
    setCart({});
    setPlanCart({});
    setClientEmail("");
    setMatchedClient(null);
    setDeliverNow(null);
    void qc.invalidateQueries({ queryKey: ["pos-products"] });
    void qc.invalidateQueries({ queryKey: ["pending-orders"] });
    void qc.invalidateQueries({ queryKey: ["admin-products"] });
    void qc.invalidateQueries({ queryKey: ["pos-recent-sales"] });
  };

  // Cobro en terminal: cola de marcas pendientes + el cobro activo.
  const [terminalQueue, setTerminalQueue] = useState<BrandGroup[]>([]);
  const [activePayment, setActivePayment] = useState<TerminalPaymentState | null>(null);
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  const [completedBrands, setCompletedBrands] = useState<string[]>([]);

  const sendToTerminal = async (group: BrandGroup) => {
    setTerminalMessage(null);
    setActivePayment({
      id: "",
      brand: group.brand,
      status: "creating",
      saleId: null,
      error: null,
      cardLast4: null,
    });
    try {
      const state = await startTerminalPayment({
        data: {
          brand: group.brand,
          clientId: matchedClient?.id ?? null,
          items: group.items.map((it) => ({ productId: it.id, qty: it.qty })),
          plans: group.plans.map((pl) => ({ planId: pl.id, qty: pl.qty })),
          origin: window.location.origin,
          deliverNow: deliverNow !== false,
        },
      });
      setActivePayment(state);
    } catch (e) {
      setActivePayment({
        id: "",
        brand: group.brand,
        status: "failed",
        saleId: null,
        error: e instanceof Error ? e.message : "No se pudo enviar el cobro a la terminal.",
        cardLast4: null,
      });
    }
  };

  // Mientras la terminal cobra, se consulta el estado (además del webhook).
  useEffect(() => {
    if (
      !activePayment?.id ||
      (activePayment.status !== "pending" && activePayment.status !== "declined")
    )
      return;
    let stop = false;
    const tick = async () => {
      try {
        const next = await checkTerminalPayment({ data: { paymentId: activePayment.id } });
        if (!stop && next.status !== activePayment.status) setActivePayment(next);
      } catch {
        // error de red puntual: se reintenta en el siguiente ciclo
      }
    };
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [activePayment?.id, activePayment?.status]);

  // Cuando un cobro se aprueba: pasa a la siguiente marca o termina la venta.
  useEffect(() => {
    if (activePayment?.status !== "completed") return;
    const brand = activePayment.brand;
    setCompletedBrands((c) => (c.includes(brand) ? c : [...c, brand]));
    const rest = terminalQueue.filter((g) => g.brand !== brand);
    setTerminalQueue(rest);
    const timer = window.setTimeout(() => {
      if (rest[0]) {
        void sendToTerminal(rest[0]);
      } else {
        toast.success(
          planQty > 0
            ? "Pago aprobado. Venta registrada y clases acreditadas al cliente."
            : "Pago aprobado. Venta registrada.",
        );
        setActivePayment(null);
        setCompletedBrands([]);
        resetSale();
      }
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona al cambio de estado del cobro
  }, [activePayment?.id, activePayment?.status]);

  const cancelActive = async () => {
    if (!activePayment?.id) {
      setActivePayment(null);
      return;
    }
    try {
      const res = await cancelTerminalPayment({ data: { paymentId: activePayment.id } });
      if (res.message) setTerminalMessage(res.message);
      setActivePayment(res);
    } catch (e) {
      setTerminalMessage(e instanceof Error ? e.message : "No se pudo cancelar.");
    }
  };

  const closeTerminalDialog = () => {
    const partial = completedBrands.length > 0;
    setActivePayment(null);
    setTerminalQueue([]);
    setTerminalMessage(null);
    if (partial) {
      // Ya se cobró una marca: se quita del carrito para no cobrarla dos veces.
      const paid = brandGroups.filter((g) => completedBrands.includes(g.brand));
      setCart((c) => {
        const next = { ...c };
        for (const g of paid) for (const it of g.items) delete next[it.id];
        return next;
      });
      setPlanCart((c) => {
        const next = { ...c };
        for (const g of paid) for (const pl of g.plans) delete next[pl.id];
        return next;
      });
      toast.message("Se registró solo la parte ya pagada. El resto sigue en el carrito.");
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    }
    setCompletedBrands([]);
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (brandGroups.length === 0) throw new Error("Agrega al menos un producto o paquete.");
      if (planBlockMessages.length > 0) throw new Error(planBlockMessages[0]);
      if (needsClient && !matchedClient) {
        throw new Error(
          isTransfer
            ? "Para cobrar por transferencia, elige al cliente."
            : hasMerch && planQty === 0
              ? "Para vender merch, elige para quién es."
              : "Para vender paquetes o clases, elige al cliente.",
        );
      }
      if (hasMerch && deliverNow === null) {
        throw new Error("Indica si el merch se entrega en este momento.");
      }

      if (usesTerminal && total > 0) {
        setCompletedBrands([]);
        setTerminalQueue(brandGroups);
        await sendToTerminal(brandGroups[0]!);
        return "terminal" as const;
      }

      // Efectivo o transferencia (ya recibida): una venta por marca + paquetes
      // acreditados al cliente.
      const method = isTransfer ? "transferencia" : "efectivo";
      for (const group of brandGroups) {
        if (group.items.length > 0) {
          const items = group.items.map(({ id, qty }) => {
            const p = products?.find((p) => p.id === id);
            return {
              product_id: id,
              description: p?.name ?? "",
              qty,
              unit_price_cents: p?.price_cents ?? 0,
            };
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla/función nueva, aún no está en los tipos generados
          const { error } = await (supabase.rpc as any)("pos_checkout", {
            _user_id: matchedClient?.id ?? null,
            _payment_method: method,
            _items: items,
            _brand: group.brand,
            _deliver_now: deliverNow !== false,
          });
          if (error) throw error;
        }
        if (group.plans.length > 0 && matchedClient) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla/función nueva, aún no está en los tipos generados
          const { error } = await (supabase.rpc as any)("pos_sell_plans_cash", {
            _user_id: matchedClient.id,
            _plans: group.plans.map((pl) => ({ plan_id: pl.id, qty: pl.qty })),
            _payment_method: method,
          });
          if (error) throw error;
        }
      }
      return "direct" as const;
    },
    onSuccess: (mode) => {
      if (mode === "terminal") return;
      setConfirmTransfer(false);
      toast.success(
        planQty > 0
          ? `${isTransfer ? "Transferencia registrada" : "Venta registrada"} y clases acreditadas al cliente.`
          : isTransfer
            ? "Transferencia registrada."
            : "Venta registrada.",
      );
      resetSale();
    },
    onError: (e) => toast.error(describeError(e, "No se pudo cobrar.")),
  });

  const qtyButtons = (qty: number, onMinus: () => void, onPlus: () => void) => (
    <div className="flex shrink-0 items-center gap-2">
      <button className="border border-input px-2.5 py-1" onClick={onMinus}>
        −
      </button>
      <span className="w-6 text-center">{qty}</span>
      <button className="border border-input px-2.5 py-1" onClick={onPlus}>
        +
      </button>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar paquete, producto o SKU…"
            className={`${input} pl-9`}
            autoFocus
          />
        </div>

        {filteredPlans.length > 0 ? (
          <div className="mb-6">
            <p className="mb-2 eyebrow">Paquetes y clases</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredPlans.map((p) => {
                const qty = planCart[p.id] ?? 0;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-3 border p-4 transition-colors ${qty > 0 ? "border-foreground" : "border-border"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {money(p.price_cents)} · {p.tokens} clase{p.tokens === 1 ? "" : "s"}
                        {p.subtitle ? ` · ${p.subtitle}` : ""}
                      </p>
                    </div>
                    {qtyButtons(
                      qty,
                      () => setPlanCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) })),
                      () =>
                        setPlanCart((c) => {
                          const current = c[p.id] ?? 0;
                          if ((p.purchasable_once || p.new_clients_only) && current >= 1) {
                            toast.message(`${p.name} solo se puede comprar una vez por cuenta.`);
                            return c;
                          }
                          return { ...c, [p.id]: current + 1 };
                        }),
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <p className="mb-2 eyebrow">Productos</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => {
            const qty = cart[p.id] ?? 0;
            const brand = (p as unknown as { brand?: string }).brand ?? "laatu";
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-3 border p-4 transition-colors ${qty > 0 ? "border-foreground" : "border-border"}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate">{p.name}</p>
                    {brand === "goodes" ? (
                      <span className="shrink-0 bg-amber-500/15 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.1em] text-amber-800">
                        Goddess
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {money(p.price_cents)} · stock {p.stock} {p.unit}
                  </p>
                </div>
                {qtyButtons(
                  qty,
                  () => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) })),
                  () => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 })),
                )}
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin productos con ese nombre.</p>
          ) : null}
        </div>
      </div>

      <div className="h-fit space-y-4 border border-border p-6">
        <p className="eyebrow">
          Cobro {itemCount > 0 ? `· ${itemCount} artículo${itemCount === 1 ? "" : "s"}` : ""}
        </p>
        <label className="relative block text-xs">
          <span className="eyebrow">
            Cliente{" "}
            {isTransfer
              ? "(obligatorio para transferencia)"
              : planQty > 0
                ? "(obligatorio para paquetes)"
                : hasMerch
                  ? "(obligatorio: ¿para quién es el merch?)"
                  : "(opcional)"}
          </span>
          <input
            value={
              matchedClient ? `${matchedClient.full_name || matchedClient.email}` : clientEmail
            }
            onChange={(e) => {
              setMatchedClient(null);
              setClientEmail(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            className={`${input} ${needsClient && !matchedClient ? "border-destructive" : ""}`}
            placeholder="Correo o nombre del cliente"
            autoComplete="off"
          />
          {matchedClient ? (
            <button
              type="button"
              onClick={() => {
                setMatchedClient(null);
                setClientEmail("");
              }}
              className="absolute right-2 top-7 text-muted-foreground hover:text-foreground"
              aria-label="Quitar cliente"
            >
              ×
            </button>
          ) : null}
          {showSuggestions && !matchedClient && (suggestions ?? []).length > 0 ? (
            <ul className="absolute z-10 mt-1 w-full border border-border bg-background shadow-lg">
              {(suggestions ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMatchedClient(c);
                      setShowSuggestions(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
                  >
                    <span className="block">{c.full_name || "Sin nombre"}</span>
                    <span className="block text-muted-foreground">{c.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {matchedClient ? (
            <span className="mt-1 block text-[0.7rem] text-emerald-600">
              ✓ {matchedClient.email}
              {needsClient ? " · las clases se le acreditan al pagar" : ""}
            </span>
          ) : needsClient ? (
            <span className="mt-1 block text-[0.7rem] text-destructive">
              {planQty > 0
                ? "Elige al cliente para acreditarle las clases."
                : hasMerch
                  ? "Elige al cliente que se lleva el merch."
                  : "Elige al cliente que hizo la transferencia."}
            </span>
          ) : null}
        </label>

        <div className="text-xs">
          <span className="eyebrow">Método de pago</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(
              [
                ["terminal", "Tarjeta (terminal Clip)"],
                ["efectivo", "Efectivo"],
                ["transferencia", "Transferencia"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPayment(value)}
                className={`border px-3 py-2 text-[0.7rem] uppercase tracking-[0.1em] ${
                  payment === value
                    ? "border-foreground bg-foreground text-background"
                    : "border-input"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {hasMerch ? (
          <div className="text-xs">
            <span className="eyebrow">¿Se entrega el merch en este momento? (obligatorio)</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(
                [
                  [true, "Sí, se lo lleva"],
                  [false, "No, queda pendiente"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setDeliverNow(value)}
                  className={`border px-3 py-2 text-[0.7rem] uppercase tracking-[0.1em] ${
                    deliverNow === value
                      ? "border-foreground bg-foreground text-background"
                      : deliverNow === null
                        ? "border-destructive"
                        : "border-input"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[0.7rem] text-muted-foreground">
              {deliverNow === false
                ? "Quedará en Pedidos pendientes con el nombre del cliente hasta que se entregue."
                : deliverNow
                  ? "Queda registrado como entregado en Pedidos pendientes."
                  : "Elige una opción para poder cobrar."}
            </p>
          </div>
        ) : null}

        {itemCount > 0 ? (
          <ul className="space-y-1 border-t border-border pt-3 text-xs">
            {brandGroups.flatMap((g) => [
              ...g.plans.map((pl) => {
                const p = plans?.find((x) => x.id === pl.id);
                return (
                  <li key={`plan-${pl.id}`} className="flex justify-between gap-2">
                    <span>
                      {pl.qty} × {p?.name}
                    </span>
                    <span>{money((p?.price_cents ?? 0) * pl.qty)}</span>
                  </li>
                );
              }),
              ...g.items.map((it) => {
                const p = products?.find((x) => x.id === it.id);
                return (
                  <li key={`prod-${it.id}`} className="flex justify-between gap-2">
                    <span>
                      {it.qty} × {p?.name}
                    </span>
                    <span>{money((p?.price_cents ?? 0) * it.qty)}</span>
                  </li>
                );
              }),
            ])}
          </ul>
        ) : null}

        <p className="text-2xl">{money(total)}</p>
        {planBlockMessages.length > 0 ? (
          <div className="space-y-1 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {planBlockMessages.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        ) : null}
        {total === 0 && planQty > 0 ? (
          <p className="border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            Convenio sin cobro en Läätu: se le acredita la clase al cliente y la plataforma (Wellhub
            / TotalPass) le paga al estudio por fuera. Recuerda validar su check-in en la app de la
            plataforma.
          </p>
        ) : null}
        {itemCount > 0 && !isMixedBrand && usesTerminal && total > 0 ? (
          <p
            className={`border px-3 py-2 text-xs uppercase tracking-[0.08em] ${
              cartBrand === "goodes"
                ? "border-amber-600/40 bg-amber-500/10 text-amber-800"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            Se enviará a la terminal: {cartBrand === "goodes" ? "Goddess" : "Läätu"}
          </p>
        ) : null}
        {isMixedBrand ? (
          <div className="space-y-1 border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900">
            <p className="uppercase tracking-[0.08em]">Carrito mixto · se cobra en 2 pasos</p>
            {brandGroups.map((g, i) => (
              <p key={g.brand} className="flex justify-between">
                <span>
                  {i + 1}. {g.brand === "goodes" ? "Goddess" : "Läätu"}
                  {usesTerminal ? " (su terminal)" : ""}
                </span>
                <span>{money(g.total)}</span>
              </p>
            ))}
          </div>
        ) : null}
        <button
          disabled={
            checkout.isPending ||
            itemCount === 0 ||
            (needsClient && !matchedClient) ||
            (hasMerch && deliverNow === null) ||
            planBlockMessages.length > 0 ||
            !!activePayment
          }
          onClick={() => {
            if (isTransfer && total > 0) {
              setConfirmTransfer(true);
              return;
            }
            checkout.mutate();
          }}
          className="w-full bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
        >
          {total === 0 && planQty > 0
            ? "Registrar convenio (sin cobro)"
            : usesTerminal
              ? "Cobrar en terminal"
              : isTransfer
                ? "Cobrar por transferencia"
                : "Cobrar en efectivo"}
        </button>
        {itemCount > 0 ? (
          <button
            type="button"
            onClick={resetSale}
            className="w-full text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
          >
            Vaciar carrito
          </button>
        ) : null}
      </div>

      {confirmTransfer && matchedClient ? (
        <Popout onClose={() => (checkout.isPending ? null : setConfirmTransfer(false))}>
          <p className="eyebrow">Cobro por transferencia</p>
          <h3 className="statement mt-1 text-2xl">{money(total)}</h3>
          <p className="mt-2 text-sm">
            Cliente: <strong>{matchedClient.full_name || matchedClient.email}</strong>
            <span className="block text-xs text-muted-foreground">{matchedClient.email}</span>
          </p>
          <ul className="mt-4 space-y-1 border-y border-border py-3 text-xs">
            {brandGroups.flatMap((g) => [
              ...g.plans.map((pl) => {
                const p = plans?.find((x) => x.id === pl.id);
                return (
                  <li key={`tp-${pl.id}`} className="flex justify-between gap-2">
                    <span>
                      {pl.qty} × {p?.name}
                    </span>
                    <span>{money((p?.price_cents ?? 0) * pl.qty)}</span>
                  </li>
                );
              }),
              ...g.items.map((it) => {
                const p = products?.find((x) => x.id === it.id);
                return (
                  <li key={`ti-${it.id}`} className="flex justify-between gap-2">
                    <span>
                      {it.qty} × {p?.name}
                    </span>
                    <span>{money((p?.price_cents ?? 0) * it.qty)}</span>
                  </li>
                );
              }),
            ])}
          </ul>
          <p className="mt-4 border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900">
            Revisa en la cuenta del banco que la transferencia ya llegó antes de confirmar.
            {planQty > 0 ? " Al confirmar se le acreditan las clases al cliente de inmediato." : ""}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={checkout.isPending}
              onClick={() => setConfirmTransfer(false)}
              className="border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] disabled:opacity-50"
            >
              Todavía no llega
            </button>
            <button
              type="button"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate()}
              className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
            >
              {checkout.isPending ? "Registrando…" : "Pago recibido"}
            </button>
          </div>
        </Popout>
      ) : null}

      {activePayment ? (
        <TerminalPaymentDialog
          payment={activePayment}
          amountCents={brandGroups.find((g) => g.brand === activePayment.brand)?.total ?? 0}
          step={isMixedBrand ? completedBrands.length + 1 : null}
          totalSteps={brandGroups.length}
          message={terminalMessage}
          onCancel={() => void cancelActive()}
          onRetry={() => {
            const group = brandGroups.find((g) => g.brand === activePayment.brand);
            if (group) void sendToTerminal(group);
          }}
          onClose={closeTerminalDialog}
        />
      ) : null}

      <div className="lg:col-span-2">
        <RecentSalesPanel />
        <TerminalsConfig />
      </div>
    </div>
  );
}

function TerminalPaymentDialog({
  payment,
  amountCents,
  step,
  totalSteps,
  message,
  onCancel,
  onRetry,
  onClose,
}: {
  payment: TerminalPaymentState;
  amountCents: number;
  step: number | null;
  totalSteps: number;
  message: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const label = payment.brand === "goodes" ? "Goddess" : "Läätu";
  const waiting =
    payment.status === "creating" || payment.status === "pending" || payment.status === "declined";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 border border-border bg-background p-6 text-center shadow-xl">
        <p className="eyebrow">
          Terminal {label}
          {step ? ` · paso ${Math.min(step, totalSteps)} de ${totalSteps}` : ""}
        </p>
        <p className="text-3xl">{money(amountCents)}</p>

        {payment.status === "creating" ? (
          <p className="text-sm text-muted-foreground">Enviando el cobro a la terminal…</p>
        ) : null}
        {payment.status === "pending" ? (
          <div className="space-y-2">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            <p className="text-sm">
              Pide al cliente que pague en la terminal de <strong>{label}</strong>.
            </p>
            <p className="text-xs text-muted-foreground">Esta pantalla se actualiza sola.</p>
          </div>
        ) : null}
        {payment.status === "declined" ? (
          <div className="space-y-2">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-amber-600" />
            <p className="text-sm text-amber-900">Tarjeta rechazada.</p>
            <p className="text-xs text-muted-foreground">
              El cliente puede tocar <strong>Reintentar</strong> en la terminal y pagar con otra
              tarjeta. Esta pantalla sigue esperando y se actualiza sola. Si ya no va a pagar,
              cancela el cobro también en la terminal.
            </p>
          </div>
        ) : null}
        {payment.status === "completed" ? (
          <p className="text-sm text-emerald-700">
            ✓ Pago aprobado{payment.cardLast4 ? ` · tarjeta ••${payment.cardLast4}` : ""}
          </p>
        ) : null}
        {payment.status === "failed" ? (
          <p className="text-sm text-destructive">{payment.error ?? "El pago no se completó."}</p>
        ) : null}
        {payment.status === "canceled" ? (
          <p className="text-sm text-muted-foreground">
            Cobro cancelado. No se registró ninguna venta.
          </p>
        ) : null}
        {message ? <p className="text-xs text-amber-800">{message}</p> : null}

        <div className="flex gap-2">
          {waiting ? (
            <button
              onClick={onCancel}
              disabled={!payment.id}
              className="flex-1 border border-input px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] disabled:opacity-50"
            >
              Cancelar cobro
            </button>
          ) : null}
          {payment.status === "failed" || payment.status === "canceled" ? (
            <>
              <button
                onClick={onRetry}
                className="flex-1 bg-foreground px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] text-background"
              >
                Reintentar
              </button>
              <button
                onClick={onClose}
                className="flex-1 border border-input px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em]"
              >
                Cerrar
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type RecentSale = {
  kind: "terminal" | "sale" | "transaction";
  id: string;
  created_at: string;
  method: string;
  brand: string;
  amount_cents: number;
  card_last4: string | null;
  refunded: boolean;
  refund_amount_cents: number | null;
  description: string | null;
  client: string | null;
};

type RefundPreview = {
  kind: RecentSale["kind"];
  method: string;
  total_cents: number;
  refund_cents: number;
  products: { name: string; qty: number }[];
  plans: { name: string; tokens: number; price_cents: number }[];
  tokens_granted: number;
  tokens_removable: number;
  tokens_used: number;
  client: { name: string | null; email: string | null } | null;
};

// Ventas del mostrador (terminal, efectivo, transferencia y paquetes) con el
// botón de reembolso. Los reembolsos se hacen SIEMPRE desde aquí, nunca
// directo en Clip, para que el dinero, los créditos y el inventario cuadren.
function RecentSalesPanel() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(true);
  const [target, setTarget] = useState<RecentSale | null>(null);
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [reason, setReason] = useState("");

  // Al abrir el POS (y cada 2 minutos) se revisan con Clip los cobros que no
  // quedaron registrados, por ejemplo un rechazo seguido de reintento.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const { recovered } = await reconcileTerminalPayments();
        if (alive && recovered > 0) {
          toast.success(
            `Se registraron ${recovered} cobro(s) con terminal que habían quedado pendientes.`,
          );
          void qc.invalidateQueries({ queryKey: ["pos-recent-sales"] });
          void qc.invalidateQueries({ queryKey: ["pos-products"] });
        }
      } catch {
        // sin conexión o sin permisos: se reintenta en el siguiente ciclo
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 120_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [qc]);

  const { data: sales, isLoading } = useQuery({
    queryKey: ["pos-recent-sales"],
    enabled: open,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("pos_recent_sales", { _limit: 40 });
      if (error) throw error;
      return (data ?? []) as RecentSale[];
    },
  });

  const openRefund = async (sale: RecentSale) => {
    setTarget(sale);
    setPreview(null);
    setReason("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
    const { data, error } = await (supabase.rpc as any)("pos_refund_preview", {
      _kind: sale.kind,
      _id: sale.id,
    });
    if (error) {
      toast.error(describeError(error, "No se pudo calcular el reembolso."));
      setTarget(null);
      return;
    }
    setPreview(data as RefundPreview);
  };

  const refund = useMutation({
    mutationFn: async () => {
      if (!target) return 0;
      if (target.kind === "terminal") {
        const res = await refundTerminalPayment({
          data: { paymentId: target.id, reason: reason.trim() },
        });
        return res.refundedCents;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.rpc as any)("pos_apply_refund", {
        _kind: target.kind,
        _id: target.id,
        _reason: reason.trim(),
      });
      if (error) throw error;
      return Number((data as RefundPreview).refund_cents);
    },
    onSuccess: (cents) => {
      const cash = target?.kind !== "terminal";
      toast.success(
        !cash
          ? `Reembolso hecho: Clip devolverá ${money(cents)} a la tarjeta.`
          : target?.method === "transferencia"
            ? `Reembolso registrado. Devuelve ${money(cents)} por transferencia al cliente.`
            : `Reembolso registrado. Entrega ${money(cents)} en efectivo al cliente.`,
      );
      setTarget(null);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["pos-recent-sales"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e) => toast.error(describeError(e, "No se pudo reembolsar.")),
  });

  const dateFmt = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mt-2 border border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs uppercase tracking-[0.12em]"
      >
        Ventas recientes y reembolsos
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="border-t border-border">
          <p className="px-4 pt-3 text-[0.7rem] text-muted-foreground">
            Reembolsa siempre desde aquí, no directo en Clip: así se devuelve el dinero, se quitan
            los créditos y el producto regresa al inventario en un solo paso.
            {isAdmin ? "" : " Solo un administrador puede hacer reembolsos."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Detalle</th>
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2">Pago</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(sales ?? []).map((s) => (
                  <tr
                    key={`${s.kind}-${s.id}`}
                    className={s.refunded ? "text-muted-foreground" : ""}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-xs">
                      {dateFmt.format(new Date(s.created_at))}
                    </td>
                    <td className="px-4 py-2">
                      {s.description || "—"}
                      {s.brand === "goodes" ? (
                        <span className="ml-2 bg-amber-500/15 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.1em] text-amber-800">
                          Goddess
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-xs">{s.client ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs">
                      {s.method === "tarjeta"
                        ? `Tarjeta${s.card_last4 ? ` ••${s.card_last4}` : ""}`
                        : s.method === "convenio"
                          ? "Convenio"
                          : s.method === "transferencia"
                            ? "Transferencia"
                            : "Efectivo"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {money(s.amount_cents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {s.refunded ? (
                        <span className="text-[0.65rem] uppercase tracking-[0.1em] text-destructive">
                          Reembolsado
                          {s.refund_amount_cents != null && s.refund_amount_cents !== s.amount_cents
                            ? ` ${money(s.refund_amount_cents)}`
                            : ""}
                        </span>
                      ) : isAdmin && s.method !== "convenio" ? (
                        <button
                          onClick={() => void openRefund(s)}
                          className="border border-input px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.12em] hover:bg-muted"
                        >
                          Reembolsar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!isLoading && (sales ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Todavía no hay ventas en el mostrador.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {target ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !refund.isPending && setTarget(null)}
        >
          <div
            className="w-full max-w-md space-y-4 border border-border bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="eyebrow">Reembolsar venta</p>
            {!preview ? (
              <p className="text-sm text-muted-foreground">Calculando…</p>
            ) : (
              <>
                <div className="space-y-1 text-sm">
                  {preview.client?.email ? (
                    <p className="text-xs text-muted-foreground">
                      Cliente: {preview.client.name || preview.client.email}
                    </p>
                  ) : null}
                  {preview.products.map((p, i) => (
                    <p key={`p${i}`}>
                      {p.qty} × {p.name}{" "}
                      <span className="text-muted-foreground">→ regresa al inventario</span>
                    </p>
                  ))}
                  {preview.plans.map((p, i) => (
                    <p key={`k${i}`}>
                      {p.name} ({p.tokens} crédito{p.tokens === 1 ? "" : "s"})
                    </p>
                  ))}
                </div>

                {preview.tokens_granted > 0 ? (
                  <p
                    className={`border px-3 py-2 text-xs ${
                      preview.tokens_used > 0
                        ? "border-amber-600/40 bg-amber-500/10 text-amber-900"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    {preview.tokens_used > 0
                      ? `El cliente ya usó ${preview.tokens_used} de ${preview.tokens_granted} créditos. Solo se le quitan los ${preview.tokens_removable} que le quedan y se devuelve la parte proporcional.`
                      : `Se le quitarán ${preview.tokens_removable} crédito${preview.tokens_removable === 1 ? "" : "s"} de su cuenta.`}
                  </p>
                ) : null}

                <div className="flex items-baseline justify-between border-t border-border pt-3">
                  <span className="text-sm">
                    {preview.method === "tarjeta"
                      ? "Se devuelve a la tarjeta"
                      : preview.method === "transferencia"
                        ? "Devolver por transferencia"
                        : "Entregar en efectivo"}
                  </span>
                  <span className="text-2xl">{money(preview.refund_cents)}</span>
                </div>
                {preview.refund_cents !== preview.total_cents ? (
                  <p className="text-[0.7rem] text-muted-foreground">
                    Pagado originalmente: {money(preview.total_cents)}
                  </p>
                ) : null}

                <label className="block text-xs">
                  <span className="eyebrow">Motivo (opcional)</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className={input}
                    placeholder="Ej. el cliente se arrepintió"
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={() => setTarget(null)}
                    disabled={refund.isPending}
                    className="flex-1 border border-input px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em]"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => refund.mutate()}
                    disabled={refund.isPending || preview.refund_cents <= 0}
                    className="flex-1 bg-destructive px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] text-destructive-foreground disabled:opacity-50"
                  >
                    {refund.isPending ? "Reembolsando…" : "Confirmar reembolso"}
                  </button>
                </div>
                {preview.refund_cents <= 0 ? (
                  <p className="text-xs text-destructive">
                    El cliente ya usó todos los créditos; no hay monto por reembolsar.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TerminalsConfig() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: terminals } = useQuery({
    queryKey: ["pos-terminals"],
    enabled: open,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla/función nueva, aún no está en los tipos generados
      const { data, error } = await (supabase.from as any)("pos_terminals")
        .select("brand, label, serial_number, active")
        .order("brand", { ascending: false });
      if (error) throw error;
      return data as {
        brand: string;
        label: string;
        serial_number: string | null;
        active: boolean;
      }[];
    },
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async (t: { brand: string; serial_number: string; active: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla/función nueva, aún no está en los tipos generados
      const { error } = await (supabase.from as any)("pos_terminals")
        .update({
          serial_number: t.serial_number.trim() || null,
          active: t.active,
          updated_at: new Date().toISOString(),
        })
        .eq("brand", t.brand);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Terminal actualizada.");
      void qc.invalidateQueries({ queryKey: ["pos-terminals"] });
    },
    onError: () =>
      toast.error("No se pudo guardar. Solo un administrador puede editar las terminales."),
  });

  return (
    <div className="mt-2 border border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs uppercase tracking-[0.12em]"
      >
        Terminales Clip
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border p-4">
          {(terminals ?? []).map((t) => {
            const value = drafts[t.brand] ?? t.serial_number ?? "";
            return (
              <div key={t.brand} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto_auto]">
                <p className="text-sm">{t.label}</p>
                <label className="block text-xs">
                  <span className="eyebrow">Número de serie</span>
                  <input
                    value={value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.brand]: e.target.value }))}
                    className={input}
                    placeholder="Ej. AA61B532642902272"
                  />
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <input
                    type="checkbox"
                    checked={t.active}
                    onChange={(e) =>
                      save.mutate({
                        brand: t.brand,
                        serial_number: value,
                        active: e.target.checked,
                      })
                    }
                  />
                  Activa
                </label>
                <button
                  onClick={() =>
                    save.mutate({ brand: t.brand, serial_number: value, active: t.active })
                  }
                  disabled={save.isPending}
                  className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.14em]"
                >
                  Guardar
                </button>
              </div>
            );
          })}
          <p className="text-[0.7rem] text-muted-foreground">
            Cada terminal está ligada a la cuenta Clip de su marca. El número de serie aparece en el
            panel de Clip, en Lectores.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// INVENTARIO
// ============================================================================
export function InventoryPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todas");

  const { data } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (payload: TablesInsert<"products">) => {
      const { error } = await supabase.from("products").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto agregado.");
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
  });

  const adjust = useMutation({
    mutationFn: async ({ id, delta, reason }: { id: string; delta: number; reason: string }) => {
      const { error } = await supabase.rpc("adjust_stock", {
        _product_id: id,
        _delta: delta,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-products"] }),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"products"> }) => {
      const { error } = await supabase.from("products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
  });

  // Si el producto ya tiene ventas o movimientos de inventario, la base de
  // datos no deja borrarlo (para no perder el historial). En ese caso se
  // quita del punto de venta en lugar de borrarse.
  const remove = useMutation({
    mutationFn: async (p: Tables<"products">) => {
      const { error } = await supabase.from("products").delete().eq("id", p.id);
      if (!error) return "deleted" as const;
      if (error.code === "23503") {
        const { error: e2 } = await supabase
          .from("products")
          .update({ active: false })
          .eq("id", p.id);
        if (e2) throw e2;
        return "hidden" as const;
      }
      throw error;
    },
    onSuccess: (result) => {
      toast.success(
        result === "deleted"
          ? "Producto eliminado."
          : "Este producto ya tiene ventas registradas, así que se quitó del punto de venta en lugar de borrarse.",
      );
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: () => toast.error("No se pudo eliminar. Solo un administrador puede hacerlo."),
  });

  const categories = Array.from(new Set((data ?? []).map((p) => p.category))).sort();

  const filtered = (data ?? []).filter((p) => {
    if (categoryFilter !== "todas" && p.category !== categoryFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
  });

  const today = new Date();
  const soon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const lowStockCount = (data ?? []).filter((p) => p.stock <= p.low_stock_threshold).length;
  const expiringCount = (data ?? []).filter(
    (p) => p.expires_at && new Date(p.expires_at) <= soon,
  ).length;

  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="border border-border p-4">
          <p className="eyebrow">SKUs activos</p>
          <p className="mt-1 text-2xl">{(data ?? []).filter((p) => p.active).length}</p>
        </div>
        <div className={`border p-4 ${lowStockCount > 0 ? "border-destructive" : "border-border"}`}>
          <p className="eyebrow">Stock bajo</p>
          <p className="mt-1 text-2xl">{lowStockCount}</p>
        </div>
        <div className={`border p-4 ${expiringCount > 0 ? "border-destructive" : "border-border"}`}>
          <p className="eyebrow">Caducan en 30 días</p>
          <p className="mt-1 text-2xl">{expiringCount}</p>
        </div>
      </div>

      <details className="mb-6 border border-border p-6">
        <summary className="cursor-pointer eyebrow">Agregar producto al punto de venta</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              name: String(f.get("name") || ""),
              ...({ brand: String(f.get("brand") || "laatu") } as object),
              category: String(f.get("category") || "consumible"),
              price_cents: Math.round(Number(f.get("price") || 0) * 100),
              cost_cents: Math.round(Number(f.get("cost") || 0) * 100),
              stock: Number(f.get("stock") || 0),
              unit: String(f.get("unit") || "pieza"),
              unit_size: String(f.get("unit_size") || ""),
              low_stock_threshold: Number(f.get("threshold") || 5),
              expires_at: f.get("expires_at") ? String(f.get("expires_at")) : null,
            });
            e.currentTarget.reset();
          }}
        >
          <label className="text-xs">
            <span className="eyebrow">Nombre</span>
            <input name="name" required className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Marca / terminal</span>
            <select name="brand" defaultValue="laatu" className={input}>
              <option value="laatu">Läätu</option>
              <option value="goodes">Goddess</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Categoría</span>
            <input
              name="category"
              defaultValue="consumible"
              className={input}
              list="inv-categories"
            />
            <datalist id="inv-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Precio de venta (MXN)</span>
            <input name="price" type="number" min={0} step="0.01" className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Costo de compra (MXN)</span>
            <input name="cost" type="number" min={0} step="0.01" className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Unidad</span>
            <select name="unit" defaultValue="pieza" className={input}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Presentación</span>
            <input name="unit_size" placeholder='ej. "500 ml"' className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Stock inicial</span>
            <input name="stock" type="number" min={0} defaultValue={0} className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Alerta stock bajo</span>
            <input name="threshold" type="number" min={0} defaultValue={5} className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Caducidad</span>
            <input name="expires_at" type="date" className={input} />
          </label>
          <div className="flex items-end">
            <button className="w-full bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
              Agregar
            </button>
          </div>
        </form>
      </details>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto o SKU…"
            className={`${input} pl-9`}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={`${input} w-auto`}
        >
          <option value="todas">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Marca</th>
              <th className="px-4 py-3">Precio / costo</th>
              <th className="px-4 py-3">Margen</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">En POS</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((p) => (
              <InventoryRow
                key={p.id}
                product={p}
                soon={soon}
                onAdjust={(delta) =>
                  adjust.mutate({
                    id: p.id,
                    delta,
                    reason: delta > 0 ? "Entrada manual" : "Salida manual",
                  })
                }
                onSave={(patch) =>
                  update.mutateAsync({ id: p.id, patch }).then(() => {
                    toast.success("Producto actualizado.");
                  })
                }
                onDelete={() => remove.mutate(p)}
              />
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Sin resultados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.7rem] text-muted-foreground">
        "En POS: Sí" significa que el producto aparece en el punto de venta para cobrarse. Los
        productos de merch activos también se muestran en la tienda de la app; los consumibles
        (bebidas, smoothies, café, barras) solo se venden en el punto de venta.
      </p>
    </div>
  );
}

type ProductRow = Tables<"products"> & { brand?: string };

function InventoryRow({
  product: p,
  soon,
  onAdjust,
  onSave,
  onDelete,
}: {
  product: ProductRow;
  soon: Date;
  onAdjust: (delta: number) => void;
  onSave: (patch: TablesUpdate<"products">) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    name: p.name,
    brand: p.brand ?? "laatu",
    category: p.category,
    price: (p.price_cents / 100).toString(),
    cost: (p.cost_cents / 100).toString(),
    threshold: String(p.low_stock_threshold),
  });
  const low = p.stock <= p.low_stock_threshold;
  const expiring = p.expires_at ? new Date(p.expires_at) <= soon : false;
  const brand = p.brand ?? "laatu";

  if (editing) {
    const price = Number(draft.price);
    const cost = Number(draft.cost);
    const valid =
      draft.name.trim() &&
      Number.isFinite(price) &&
      price >= 0 &&
      Number.isFinite(cost) &&
      cost >= 0;
    return (
      <tr className="bg-muted/40">
        <td className="px-4 py-3" colSpan={7}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs sm:col-span-2">
              <span className="eyebrow">Nombre</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className={input}
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Marca / terminal</span>
              <select
                value={draft.brand}
                onChange={(e) => setDraft((d) => ({ ...d, brand: e.target.value }))}
                className={input}
              >
                <option value="laatu">Läätu</option>
                <option value="goodes">Goddess</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="eyebrow">Categoría</span>
              <input
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                className={input}
                list="inv-categories"
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Precio de venta (MXN)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.price}
                onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                className={input}
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Costo (MXN)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.cost}
                onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
                className={input}
              />
            </label>
            <label className="text-xs">
              <span className="eyebrow">Alerta stock bajo</span>
              <input
                type="number"
                min={0}
                value={draft.threshold}
                onChange={(e) => setDraft((d) => ({ ...d, threshold: e.target.value }))}
                className={input}
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="border border-input px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em]"
            >
              Cancelar
            </button>
            <button
              disabled={!valid || saving}
              onClick={() => {
                setSaving(true);
                onSave({
                  name: draft.name.trim(),
                  category: draft.category.trim() || p.category,
                  price_cents: Math.round(price * 100),
                  cost_cents: Math.round(cost * 100),
                  low_stock_threshold: Math.max(0, Math.round(Number(draft.threshold) || 0)),
                  ...({ brand: draft.brand } as object),
                })
                  .then(() => setEditing(false))
                  .catch((e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "No se pudo guardar."),
                  )
                  .finally(() => setSaving(false));
              }}
              className="bg-foreground px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] text-background disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={p.active ? "" : "text-muted-foreground"}>
      <td className="px-4 py-3">
        <p>{p.name}</p>
        <p className="text-xs text-muted-foreground">
          {p.category}
          {p.unit_size ? ` · ${p.unit_size}` : ""}
          {p.expires_at ? (
            <span className={expiring ? " text-destructive" : ""}>
              {" · caduca "}
              {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                new Date(p.expires_at),
              )}
            </span>
          ) : null}
        </p>
      </td>
      <td className="px-4 py-3">
        {brand === "goodes" ? (
          <span className="bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] text-amber-800">
            Goddess
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Läätu</span>
        )}
      </td>
      <td className="px-4 py-3">
        {money(p.price_cents)}
        <span className="text-muted-foreground"> / {money(p.cost_cents)}</span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {p.price_cents > 0
          ? `${Math.round(((p.price_cents - p.cost_cents) / p.price_cents) * 100)}%`
          : "—"}
      </td>
      <td className={`px-4 py-3 ${low ? "text-destructive" : ""}`}>
        <div className="flex items-center gap-2">
          <button className="border border-input px-2 py-0.5" onClick={() => onAdjust(-1)}>
            −
          </button>
          <span className="whitespace-nowrap">
            {p.stock} {p.unit}
            {low ? " · bajo" : ""}
          </span>
          <button className="border border-input px-2 py-0.5" onClick={() => onAdjust(1)}>
            +
          </button>
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => void onSave({ active: !p.active })}
          className={`px-2 py-1 text-[0.65rem] uppercase tracking-[0.12em] ${
            p.active ? "bg-emerald-600/15 text-emerald-800" : "border border-input"
          }`}
          title={p.active ? "Quitar del punto de venta" : "Agregar al punto de venta"}
        >
          {p.active ? "Sí" : "No"}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            className="border border-input px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.12em]"
            onClick={() => setEditing(true)}
          >
            Editar
          </button>
          <button
            className="border border-destructive/40 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.12em] text-destructive"
            onClick={() => {
              if (window.confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) {
                onDelete();
              }
            }}
          >
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// CHECK-IN — selecciona automáticamente la clase en curso
// ============================================================================
function pickCurrentClass(classes: Tables<"classes">[] | undefined) {
  if (!classes || classes.length === 0) return "";
  const now = Date.now();
  // clase en curso (ya empezó, aún dentro de su duración + 15 min de cortesía)
  const inProgress = classes.find((c) => {
    const start = new Date(c.starts_at).getTime();
    const end = start + (c.duration_min + 15) * 60_000;
    return now >= start - 15 * 60_000 && now <= end;
  });
  if (inProgress) return inProgress.id;
  // si ninguna está en curso, la próxima que va a empezar
  const upcoming = classes.filter((c) => new Date(c.starts_at).getTime() > now);
  return upcoming[0]?.id ?? classes[0]?.id ?? "";
}

export function CheckInPanel() {
  const qc = useQueryClient();
  const [classId, setClassId] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: classes } = useQuery({
    queryKey: ["checkin-classes"],
    queryFn: async () => {
      const from = new Date();
      from.setHours(from.getHours() - 3);
      const to = new Date();
      to.setHours(to.getHours() + 12);
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .gte("starts_at", from.toISOString())
        .lte("starts_at", to.toISOString())
        .order("starts_at")
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!classId && classes) setClassId(pickCurrentClass(classes));
  }, [classes, classId]);

  const { data: rows } = useQuery({
    enabled: Boolean(classId),
    queryKey: ["checkin-bookings", classId],
    queryFn: async () => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("class_id", classId)
        .eq("status", "reservada");
      if (error) throw error;
      const ids = (bookings ?? []).map((b) => b.user_id);
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
        : { data: [] as { id: string; full_name: string; email: string }[] };
      const { data: checks } = await supabase
        .from("check_ins")
        .select("*")
        .in(
          "booking_id",
          (bookings ?? []).map((b) => b.id),
        );
      return (bookings ?? []).map((b) => ({
        ...b,
        profile: profiles?.find((p) => p.id === b.user_id),
        checkin: checks?.find((c) => c.booking_id === b.id),
      }));
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({
      bookingId,
      status,
    }: {
      bookingId: string;
      status: "a_tiempo" | "tarde" | "no_show";
    }) => {
      if (status === "no_show") {
        // El monto real ($150 MXN) lo decide el servidor y solo aplica si el
        // cliente tiene membresía activa — este valor es solo informativo.
        const { error } = await supabase.rpc("mark_no_show", {
          _booking_id: bookingId,
          _penalty_cents: 15000,
        });
        if (error) throw error;
        await tryChargePendingNoShowFee(bookingId);
      } else {
        const { error } = await supabase
          .from("check_ins")
          .upsert({ booking_id: bookingId, status }, { onConflict: "booking_id" });
        if (error) throw error;
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["checkin-bookings", classId] }),
  });

  const filteredRows = (rows ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (r.profile?.full_name ?? "").toLowerCase().includes(q) ||
      (r.profile?.email ?? "").toLowerCase().includes(q)
    );
  });

  const currentClass = classes?.find((c) => c.id === classId);

  return (
    <div>
      <div className="mb-6 grid min-w-0 items-end gap-4 md:grid-cols-2">
        <label className="min-w-0 text-xs">
          <span className="eyebrow">Clase (se selecciona sola según la hora)</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={input}>
            {(classes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {new Intl.DateTimeFormat("es-MX", { timeStyle: "short" }).format(
                  new Date(c.starts_at),
                )}{" "}
                · {c.room} · {c.instructor}
              </option>
            ))}
          </select>
        </label>
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre…"
            className={`${input} pl-9`}
          />
        </div>
      </div>

      {currentClass ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {currentClass.room} con {currentClass.instructor} ·{" "}
          {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(currentClass.starts_at),
          )}
        </p>
      ) : null}

      <ul className="divide-y divide-border border-y border-border text-sm">
        {filteredRows.map((r) => (
          <li
            key={r.id}
            className="grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
          >
            <div className="min-w-0 break-words">
              <p>{r.profile?.full_name || "Sin nombre"}</p>
              <p className="text-muted-foreground">{r.profile?.email}</p>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-2">
              <Button
                variant="outline"
                onClick={() => setStatus.mutate({ bookingId: r.id, status: "a_tiempo" })}
                className={`border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] ${r.checkin?.status === "a_tiempo" ? "border-foreground bg-foreground text-background" : "border-input"}`}
              >
                A tiempo
              </Button>
              <Button
                variant="outline"
                onClick={() => setStatus.mutate({ bookingId: r.id, status: "tarde" })}
                className={`border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] ${r.checkin?.status === "tarde" ? "border-foreground bg-foreground text-background" : "border-input"}`}
              >
                Tarde
              </Button>
              <Button
                variant="outline"
                onClick={() => setStatus.mutate({ bookingId: r.id, status: "no_show" })}
                className={`border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] text-destructive ${r.checkin?.status === "no_show" ? "border-destructive bg-destructive text-background" : "border-input"}`}
              >
                No-show
              </Button>
            </div>
          </li>
        ))}
        {classId && filteredRows.length === 0 ? (
          <li className="py-6 text-muted-foreground">Sin reservas para esta clase.</li>
        ) : null}
      </ul>
    </div>
  );
}

// ============================================================================
// CLIENTES: perfil, historial, y análisis financiero/asistencia
// ============================================================================
// ============================================================================
// DASHBOARD (Inicio) — resumen general con clases de hoy, nuevos clientes y
// accesos rápidos.
// ============================================================================
const STAFF_HOME_BUTTONS = [
  { key: "pos", label: "Punto de venta", icon: ShoppingCart },
  { key: "horarios-clases", label: "Reservaciones y créditos", icon: Users },
  { key: "check-in", label: "Check-in", icon: ClipboardCheck },
] as const;

const STAFF_HOME_DESCRIPTIONS: Record<string, string> = {
  pos: "Cobra paquetes, clases y productos en el mostrador.",
  "horarios-clases": "Reserva o mete a alguien a una clase, revisa cupo.",
  "check-in": "Marca la llegada de quien ya tiene su lugar reservado.",
};

export function StaffHomePanel({ onGoTo }: { onGoTo: (key: string, moduleKey?: string) => void }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-4 py-2 md:grid-cols-2 xl:grid-cols-3">
      {STAFF_HOME_BUTTONS.map(({ key, label, icon: Icon }) => (
        <Button
          variant="outline"
          key={key}
          type="button"
          onClick={() => onGoTo(key)}
          className="group grid h-auto min-h-44 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start justify-start gap-4 whitespace-normal border-border bg-background p-6 text-left md:min-h-48 xl:flex xl:flex-col xl:gap-5"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background transition-colors group-hover:bg-foreground/90">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-lg">{label}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {STAFF_HOME_DESCRIPTIONS[key] ?? ""}
            </p>
          </div>
        </Button>
      ))}
    </div>
  );
}

const DASHBOARD_MODULES = [
  { key: "reformer", label: "Reformer Studio" },
  { key: "4mat", label: "4MAT Studio" },
  { key: "contraste", label: "Contrast Therapy" },
  { key: "rehabilitacion", label: "DorisFisio" },
] as const;

export function DashboardPanel({ onGoTo }: { onGoTo: (key: string, moduleKey?: string) => void }) {
  const todayBounds = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, []);

  const { data: todayClasses } = useQuery({
    queryKey: ["dashboard-today-classes", todayBounds.start.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("active", true)
        .gte("starts_at", todayBounds.start.toISOString())
        .lt("starts_at", todayBounds.end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data;
    },
  });

  const classIds = useMemo(() => (todayClasses ?? []).map((c) => c.id), [todayClasses]);

  const { data: counts } = useQuery({
    queryKey: ["dashboard-today-counts", classIds.join(",")],
    enabled: classIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .in("class_id", classIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const b of data ?? []) {
        if (b.status === "reservada") map.set(b.class_id, (map.get(b.class_id) ?? 0) + 1);
      }
      return map;
    },
  });

  const { data: newSignups } = useQuery({
    queryKey: ["dashboard-newest-signups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, created_at")
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data;
    },
  });

  const monthStart = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const { data: monthBookings } = useQuery({
    queryKey: ["dashboard-month-bookings", monthStart.toISOString()],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .gte("created_at", monthStart.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });

  const totalCapacityToday = (todayClasses ?? []).reduce((sum, c) => sum + c.capacity, 0);
  const totalBookedToday = (todayClasses ?? []).reduce(
    (sum, c) => sum + (counts?.get(c.id) ?? 0),
    0,
  );
  const occupancyPct =
    totalCapacityToday > 0 ? Math.round((totalBookedToday / totalCapacityToday) * 100) : 0;

  const timeAgo = (iso: string) => {
    const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 60) return `hace ${diffMin} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `hace ${diffH} h`;
    return `hace ${Math.round(diffH / 24)} d`;
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border border-border p-6">
          <p className="eyebrow">Reservaciones del mes</p>
          <p className="mt-2 text-3xl">{monthBookings ?? 0}</p>
        </div>
        <div className="border border-border p-6">
          <p className="eyebrow">Ocupación de hoy</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0">
              <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-muted"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${occupancyPct * 0.974} 1000`}
                  className="text-emerald-500"
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                {occupancyPct}%
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {totalBookedToday}/{totalCapacityToday} lugares
            </p>
          </div>
        </div>
        <div className="border border-border p-6">
          <p className="eyebrow">Clases hoy</p>
          <p className="mt-2 text-3xl">{(todayClasses ?? []).length}</p>
        </div>
      </div>

      {/* Tarjetas por salón: solo la clase en curso y las siguientes. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {DASHBOARD_MODULES.map((m) => {
          const now = Date.now();
          const upcoming = (todayClasses ?? [])
            .filter((c) => c.module_key === m.key)
            .filter((c) => new Date(c.starts_at).getTime() + c.duration_min * 60000 > now)
            .slice(0, 3);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onGoTo("horarios-clases", m.key)}
              className="flex flex-col gap-3 border border-border bg-background p-5 text-left transition-colors hover:border-foreground"
            >
              <p className="eyebrow">{m.label}</p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin clases por venir hoy.</p>
              ) : (
                <ul className="space-y-2.5">
                  {upcoming.map((c, i) => {
                    const booked = counts?.get(c.id) ?? 0;
                    const live = new Date(c.starts_at).getTime() <= now;
                    return (
                      <li key={c.id} className="text-sm">
                        <p className={cn("tabular-nums", i === 0 && "font-semibold")}>
                          {new Intl.DateTimeFormat("es-MX", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }).format(new Date(c.starts_at))}{" "}
                          · {c.instructor}
                          {live ? (
                            <span className="ml-2 text-[0.6rem] uppercase tracking-[0.1em] text-emerald-600">
                              En curso
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {booked}/{c.capacity} ocupado · {c.room}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <span className="mt-auto pt-2 text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
                Ver salón
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <div>
          <p className="mb-3 eyebrow">Nuevos clientes</p>

          <ul className="divide-y divide-border border-y border-border text-sm">
            {(newSignups ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-muted text-[0.65rem] text-muted-foreground">
                  {(s.full_name || s.email)
                    .split(" ")
                    .slice(0, 2)
                    .map((p) => p[0]?.toUpperCase())
                    .join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{s.full_name || "Sin nombre"}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                </div>
                <span className="shrink-0 text-[0.62rem] text-muted-foreground">
                  {timeAgo(s.created_at)}
                </span>
              </li>
            ))}
            {(newSignups ?? []).length === 0 ? (
              <li className="py-6 text-muted-foreground">Sin registros todavía.</li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function ClientsPanel() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // El staff (admins, recepción, coaches) también tiene cuenta y por lo
      // tanto fila en `profiles` — pero son trabajadores, no clientes, así
      // que se excluyen de este listado por su user_id en staff_profiles.
      const { data: staffProfiles } = await supabase.from("staff_profiles").select("user_id");
      const staffUserIds = new Set((staffProfiles ?? []).map((s) => s.user_id).filter(Boolean));
      const clientProfiles = (profiles ?? []).filter((p) => !staffUserIds.has(p.id));

      const { data: ledger } = await supabase.from("token_ledger").select("user_id, delta, reason");
      const { data: waivers } = await supabase.from("waiver_signatures").select("user_id");
      const { data: bookings } = await supabase.from("bookings").select("id, user_id, status");
      const { data: transactions, error: transactionsError } = await supabase
        .from("transactions")
        .select(
          "user_id, plan_id, amount_cents, status, access_starts_at, access_ends_at, token_plans(name, daily_class_limit)",
        );
      if (transactionsError) throw transactionsError;
      const purchasesByUser = groupClientPurchases(transactions ?? []);
      const { data: checkIns } = await supabase.from("check_ins").select("booking_id, status");

      const balances = new Map<string, number>();
      const refunds = new Map<string, number>();
      for (const row of ledger ?? []) {
        balances.set(row.user_id, (balances.get(row.user_id) ?? 0) + row.delta);
        if (row.reason?.toLowerCase().includes("reembolso")) {
          refunds.set(row.user_id, (refunds.get(row.user_id) ?? 0) + 1);
        }
      }
      const signed = new Set((waivers ?? []).map((w) => w.user_id));
      const revenue = new Map<string, number>();
      // Membresía vigente (o pagada y por iniciar) de cada cliente, para
      // verla en el listado sin tener que abrir la ficha.
      const nowMs = Date.now();
      const memberships = new Map<string, ClientMembership>();
      for (const t of transactions ?? []) {
        if (t.status !== "completed") continue;
        revenue.set(t.user_id, (revenue.get(t.user_id) ?? 0) + t.amount_cents);
        const plan = t.token_plans as { name: string; daily_class_limit: number | null } | null;
        if (!plan?.daily_class_limit || !t.access_starts_at || !t.access_ends_at) continue;
        const start = new Date(t.access_starts_at).getTime();
        const end = new Date(t.access_ends_at).getTime();
        if (end < nowMs) continue;
        const candidate: ClientMembership = {
          name: plan.name,
          upcoming: start > nowMs,
          starts_at: t.access_starts_at,
          ends_at: t.access_ends_at,
        };
        const prev = memberships.get(t.user_id);
        // Prioridad: la activa hoy; si no hay, la próxima en iniciar.
        if (
          !prev ||
          (prev.upcoming && !candidate.upcoming) ||
          (prev.upcoming === candidate.upcoming &&
            (candidate.upcoming
              ? candidate.starts_at < prev.starts_at
              : candidate.ends_at > prev.ends_at))
        ) {
          memberships.set(t.user_id, candidate);
        }
      }
      const bookingsByUser = new Map<
        string,
        { total: number; attended: number; no_show: number; cancelled: number }
      >();
      const checkInByBooking = new Map((checkIns ?? []).map((c) => [c.booking_id, c.status]));
      for (const b of bookings ?? []) {
        const acc = bookingsByUser.get(b.user_id) ?? {
          total: 0,
          attended: 0,
          no_show: 0,
          cancelled: 0,
        };
        acc.total += 1;
        if (b.status === "cancelada") acc.cancelled += 1;
        const st = checkInByBooking.get(b.id);
        if (st === "a_tiempo" || st === "tarde") acc.attended += 1;
        if (st === "no_show") acc.no_show += 1;
        bookingsByUser.set(b.user_id, acc);
      }

      return clientProfiles.map((p) => ({
        ...p,
        balance: balances.get(p.id) ?? 0,
        waiver: signed.has(p.id),
        revenue_cents: revenue.get(p.id) ?? 0,
        membership: memberships.get(p.id) ?? null,
        purchases: purchasesByUser.get(p.id) ?? [],
        refund_events: refunds.get(p.id) ?? 0,
        bookings: bookingsByUser.get(p.id) ?? { total: 0, attended: 0, no_show: 0, cancelled: 0 },
      }));
    },
  });

  const adjust = useMutation({
    mutationFn: async ({ userId, delta }: { userId: string; delta: number }) => {
      const { error } = await supabase.rpc("admin_adjust_tokens", {
        _user_id: userId,
        _delta: delta,
        _reason: "Ajuste manual del estudio",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saldo actualizado.");
      void qc.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: () => toast.error("No se pudo ajustar el saldo."),
  });

  const [search, setSearch] = useState("");
  const [purchaseFilter, setPurchaseFilter] = useState("all");
  const purchaseOptions = useMemo(() => {
    const options = new Map<string, { name: string; sales: number }>();
    for (const client of data ?? [])
      for (const purchase of client.purchases) {
        const previous = options.get(purchase.planId);
        options.set(purchase.planId, {
          name: purchase.name,
          sales: (previous?.sales ?? 0) + purchase.count,
        });
      }
    return [...options.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "es"));
  }, [data]);
  const filtered = (data ?? []).filter((c) =>
    matchesClientPurchaseFilter(c, search, purchaseFilter),
  );

  const summary = useMemo(() => {
    const totalRevenue = (data ?? []).reduce((sum, c) => sum + c.revenue_cents, 0);
    const totalClients = (data ?? []).length;
    const totalAttended = (data ?? []).reduce((sum, c) => sum + c.bookings.attended, 0);
    const totalNoShow = (data ?? []).reduce((sum, c) => sum + c.bookings.no_show, 0);
    const totalRefundEvents = (data ?? []).reduce((sum, c) => sum + c.refund_events, 0);
    return { totalRevenue, totalClients, totalAttended, totalNoShow, totalRefundEvents };
  }, [data]);

  const [openClientId, setOpenClientId] = useState<string | null>(null);

  // La ficha del cliente se muestra dentro del mismo panel, conservando el
  // menú lateral y el encabezado del ambiente administrativo.
  if (openClientId) {
    return (
      <ClientDetailDrawer
        clientId={openClientId}
        onClose={() => {
          setOpenClientId(null);
          void qc.invalidateQueries({ queryKey: ["admin-clients"] });
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="border border-border p-4">
          <p className="eyebrow">Ingresos totales</p>
          <p className="mt-1 text-xl">{money(summary.totalRevenue)}</p>
        </div>
        <div className="border border-border p-4">
          <p className="eyebrow">Clientes</p>
          <p className="mt-1 text-xl">{summary.totalClients}</p>
        </div>
        <div className="border border-border p-4">
          <p className="eyebrow">Asistencias</p>
          <p className="mt-1 text-xl">{summary.totalAttended}</p>
        </div>
        <div className="border border-border p-4">
          <p className="eyebrow">No-shows</p>
          <p className="mt-1 text-xl">{summary.totalNoShow}</p>
        </div>
        <div className="border border-border p-4">
          <p className="eyebrow">Créditos reembolsados</p>
          <p className="mt-1 text-xl">{summary.totalRefundEvents}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar cliente o paquete"
            placeholder="Buscar por nombre, correo o paquete…"
            className={`${input} pl-9`}
          />
        </div>
        <Select value={purchaseFilter} onValueChange={setPurchaseFilter}>
          <SelectTrigger aria-label="Filtrar por paquete comprado" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los paquetes</SelectItem>
            {purchaseOptions.map(([id, option]) => (
              <SelectItem key={id} value={id}>
                {option.name} · {option.sales} {option.sales === 1 ? "venta" : "ventas"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="divide-y divide-border border-y border-border text-sm">
        {filtered.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <button
              type="button"
              onClick={() => setOpenClientId(c.id)}
              className="min-w-0 flex-1 text-left hover:opacity-70"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p>{c.full_name || "Sin nombre"}</p>
                {c.membership ? <MembershipBadge membership={c.membership} /> : null}
              </div>
              {c.purchases.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.purchases.map((purchase) => (
                    <span
                      key={purchase.planId}
                      title="Compra realizada"
                      className="inline-flex max-w-full items-center border border-border bg-muted px-2 py-0.5 text-[0.65rem] text-muted-foreground"
                    >
                      {purchase.name}
                      {purchase.count > 1 ? ` · ${purchase.count} compras` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="text-muted-foreground">
                {c.email}
                {c.phone ? ` · ${c.phone}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.waiver ? "Waiver ✓" : "Sin waiver"} · {money(c.revenue_cents)} pagados ·{" "}
                {c.bookings.attended} asistidas · {c.bookings.no_show} no-show ·{" "}
                {c.bookings.cancelled} canceladas
                {c.refund_events > 0 ? ` · ${c.refund_events} reembolsos` : ""}
              </p>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => adjust.mutate({ userId: c.id, delta: -1 })}
                className="border border-input px-3 py-1.5"
                aria-label="Restar un token"
              >
                −
              </button>
              <span className="w-10 text-center text-lg">{c.balance}</span>
              <button
                onClick={() => adjust.mutate({ userId: c.id, delta: 1 })}
                className="border border-input px-3 py-1.5"
                aria-label="Sumar un token"
              >
                +
              </button>
            </div>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="py-6 text-muted-foreground">Sin resultados.</li>
        ) : null}
      </ul>
    </div>
  );
}

type ClientMembership = {
  name: string;
  upcoming: boolean;
  starts_at: string;
  ends_at: string;
};

const fmtShortDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "America/Monterrey",
  }).format(new Date(iso));

function MembershipBadge({ membership }: { membership: ClientMembership }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] ${
        membership.upcoming ? TONE_CLASSES["amber"] : TONE_CLASSES["green"]
      }`}
      title={`Vigente del ${fmtShortDate(membership.starts_at)} al ${fmtShortDate(membership.ends_at)}`}
    >
      {membership.upcoming ? "Membresía por iniciar" : "Membresía activa"} · {membership.name} ·{" "}
      {membership.upcoming
        ? `inicia ${fmtShortDate(membership.starts_at)}`
        : `hasta ${fmtShortDate(membership.ends_at)}`}
    </span>
  );
}

function bookingStatusTone(status: string, checkin: string | undefined) {
  if (status === "cancelada") return { label: "Canceló", tone: "amber" as const };
  if (checkin === "a_tiempo" || checkin === "tarde")
    return { label: "Asistió", tone: "green" as const };
  if (checkin === "no_show") return { label: "No asistió (token consumido)", tone: "red" as const };
  if (status === "lista_espera") return { label: "Lista de espera", tone: "amber" as const };
  return { label: "Reservada", tone: "muted" as const };
}

const TONE_CLASSES: Record<string, string> = {
  green: "bg-green-500/10 text-green-700",
  amber: "bg-amber-500/10 text-amber-700",
  red: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

type ClientTab = "reservaciones" | "compras" | "creditos" | "notas";
const CLIENT_TABS: { key: ClientTab; label: string }[] = [
  { key: "reservaciones", label: "Reservaciones" },
  { key: "compras", label: "Compras" },
  { key: "creditos", label: "Créditos" },
  { key: "notas", label: "Notas" },
];

const fmtLongDate = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Monterrey",
  }).format(new Date(iso));

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="border border-border bg-background p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-2xl leading-none">{value}</p>
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Calendar;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words text-sm">{value}</p>
      </div>
    </div>
  );
}

function EditClientPopout({
  profile,
  onClose,
  onSaved,
}: {
  profile: Tables<"profiles">;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(updateClientProfile);
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const save = useMutation({
    mutationFn: () => updateFn({ data: { clientId: profile.id, fullName, email, phone } }),
    onSuccess: () => {
      toast.success("Datos del cliente actualizados.");
      onSaved();
    },
    onError: (e) => toast.error(describeError(e, "No se pudieron guardar los cambios.")),
  });
  const emailChanged = email.trim().toLowerCase() !== (profile.email ?? "").toLowerCase();

  return (
    <Popout onClose={onClose}>
      <p className="eyebrow">Editar cliente</p>
      <p className="mt-1 text-lg">{profile.full_name || "Sin nombre"}</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block">
          <span className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
            Nombre completo
          </span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={`${input} mt-1`}
            required
          />
        </label>
        <label className="block">
          <span className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
            Correo
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${input} mt-1`}
            required
          />
          {emailChanged ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              El cliente tendrá que iniciar sesión con este nuevo correo.
            </span>
          ) : null}
        </label>
        <label className="block">
          <span className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
            Teléfono
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${input} mt-1`}
            placeholder="81 1234 5678"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-input px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="bg-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-background disabled:opacity-40"
          >
            {save.isPending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Popout>
  );
}

function DeleteClientPopout({
  profile,
  onClose,
  onDeleted,
}: {
  profile: Tables<"profiles">;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deleteFn = useServerFn(deleteClient);
  const [confirmText, setConfirmText] = useState("");
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { clientId: profile.id } }),
    onSuccess: () => {
      toast.success("Cliente eliminado.");
      onDeleted();
    },
    onError: (e) => toast.error(describeError(e, "No se pudo borrar al cliente.")),
  });
  const ready = confirmText.trim().toUpperCase() === "BORRAR";

  return (
    <Popout onClose={onClose}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
        <Trash2 className="h-5 w-5 text-destructive" />
      </div>
      <p className="mt-4 text-lg">Borrar a {profile.full_name || profile.email}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Se elimina su cuenta junto con sus reservaciones, créditos y notas. Esta acción no se puede
        deshacer. Si el cliente ya tiene compras pagadas no se podrá borrar, para no alterar las
        finanzas del estudio.
      </p>
      <label className="mt-5 block">
        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
          Escribe BORRAR para confirmar
        </span>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className={`${input} mt-1`}
          autoFocus
        />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="border border-input px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!ready || remove.isPending}
          onClick={() => remove.mutate()}
          className="bg-destructive px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-destructive-foreground disabled:opacity-40"
        >
          {remove.isPending ? "Borrando…" : "Borrar cliente"}
        </button>
      </div>
    </Popout>
  );
}

function ClientDetailDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<ClientTab>("reservaciones");
  const [showPackages, setShowPackages] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<Tables<"token_plans"> | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["client-detail-profile", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", clientId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: waiverSigned } = useQuery({
    queryKey: ["client-detail-waiver", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("waiver_signatures")
        .select("user_id")
        .eq("user_id", clientId)
        .limit(1);
      return (data ?? []).length > 0;
    },
  });

  const { data: reservations } = useQuery({
    queryKey: ["client-detail-bookings", clientId],
    queryFn: async () => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const classIds = (bookings ?? []).map((b) => b.class_id);
      const { data: classes } = classIds.length
        ? await supabase
            .from("classes")
            .select("id, starts_at, module_key, room")
            .in("id", classIds)
        : {
            data: [] as {
              id: string;
              starts_at: string;
              module_key: string | null;
              room: string;
            }[],
          };
      const { data: checks } = await supabase
        .from("check_ins")
        .select("*")
        .in(
          "booking_id",
          (bookings ?? []).map((b) => b.id),
        );
      return (bookings ?? []).map((b) => ({
        ...b,
        cls: classes?.find((c) => c.id === b.class_id),
        checkin: checks?.find((c) => c.booking_id === b.id),
      }));
    },
  });

  const { data: purchases } = useQuery({
    queryKey: ["client-detail-purchases", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, plan:token_plans(name)")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: balance } = useQuery({
    queryKey: ["client-detail-balance", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_ledger")
        .select("delta")
        .eq("user_id", clientId);
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + r.delta, 0);
    },
  });

  const { data: plans } = useQuery({
    enabled: showPackages,
    queryKey: ["client-detail-plans"],
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

  const saveNotes = useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase
        .from("profiles")
        .update({ admin_notes: notes })
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notas guardadas.");
      setNotesDraft(null);
      void qc.invalidateQueries({ queryKey: ["client-detail-profile", clientId] });
    },
    onError: () => toast.error("No se pudieron guardar las notas."),
  });

  const stats = useMemo(() => {
    const rows = reservations ?? [];
    let attended = 0;
    let noShow = 0;
    let cancelled = 0;
    let lastVisit: string | null = null;
    let nextClass: string | null = null;
    const now = Date.now();
    for (const r of rows) {
      const st = r.checkin?.status;
      if (r.status === "cancelada") cancelled += 1;
      if (st === "a_tiempo" || st === "tarde") {
        attended += 1;
        const at = r.cls?.starts_at;
        if (at && (!lastVisit || at > lastVisit)) lastVisit = at;
      }
      if (st === "no_show") noShow += 1;
      const at = r.cls?.starts_at;
      if (
        at &&
        r.status !== "cancelada" &&
        r.status !== "lista_espera" &&
        new Date(at).getTime() > now &&
        (!nextClass || at < nextClass)
      ) {
        nextClass = at;
      }
    }
    const paid = (purchases ?? [])
      .filter((t) => t.status === "completed")
      .reduce((sum, t) => sum + t.amount_cents, 0);
    return { attended, noShow, cancelled, lastVisit, nextClass, paid };
  }, [reservations, purchases]);

  const initials = (profile?.full_name || profile?.email || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  const tabCounts: Partial<Record<ClientTab, number>> = {
    reservaciones: (reservations ?? []).length,
    compras: (purchases ?? []).length,
  };

  const refreshProfile = () => {
    void qc.invalidateQueries({ queryKey: ["client-detail-profile", clientId] });
    void qc.invalidateQueries({ queryKey: ["admin-clients"] });
  };

  return (
    <div>
      <button
        onClick={onClose}
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a clientes
      </button>

      {/* Encabezado: identidad del cliente + acciones */}
      <div className="border border-border bg-muted/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-center gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-foreground text-xl tracking-wide text-background">
              {initials || "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-2xl">{profile?.full_name || "Sin nombre"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem]",
                    waiverSigned ? TONE_CLASSES["green"] : TONE_CLASSES["amber"],
                  )}
                >
                  {waiverSigned ? (
                    <ShieldCheck className="h-3 w-3" />
                  ) : (
                    <ShieldAlert className="h-3 w-3" />
                  )}
                  {waiverSigned ? "Waiver firmado" : "Sin waiver"}
                </span>
                {profile?.created_at ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem]",
                      TONE_CLASSES["muted"],
                    )}
                  >
                    Cliente desde {fmtLongDate(profile.created_at)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {isAdmin ? (
              <>
                {profile ? (
                  <PasswordResetControl
                    targetId={clientId}
                    targetKind="client"
                    name={profile.full_name || "Cliente"}
                    email={profile.email}
                  />
                ) : null}
                <button
                  onClick={() => setEditing(true)}
                  disabled={!profile}
                  className="inline-flex items-center gap-2 border border-input bg-background px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted disabled:opacity-40"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
                <button
                  onClick={() => setDeleting(true)}
                  disabled={!profile}
                  className="inline-flex items-center gap-2 border border-destructive/40 bg-background px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-destructive hover:bg-destructive/10 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Borrar
                </button>
              </>
            ) : null}
            <button
              onClick={() => {
                setTab("creditos");
                setShowPackages(true);
              }}
              className="inline-flex items-center gap-2 bg-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-background"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Comprar créditos
            </button>
          </div>
        </div>
      </div>

      {/* Resumen rápido */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Créditos" value={balance ?? 0} hint="Disponibles hoy" />
        <StatTile label="Asistencias" value={stats.attended} />
        <StatTile label="No-shows" value={stats.noShow} />
        <StatTile label="Cancelaciones" value={stats.cancelled} />
        <StatTile label="Total pagado" value={money(stats.paid)} />
        <StatTile
          label="Última visita"
          value={stats.lastVisit ? fmtShortDate(stats.lastVisit) : "—"}
          hint={stats.nextClass ? `Próxima: ${fmtShortDate(stats.nextClass)}` : undefined}
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Columna principal: pestañas */}
        <div className="min-w-0">
          <div className="flex gap-6 overflow-x-auto border-b border-border">
            {CLIENT_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "shrink-0 border-b-2 pb-3 text-[0.72rem] uppercase tracking-[0.12em]",
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {tabCounts[t.key] ? (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
                    {tabCounts[t.key]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="py-6">
            {tab === "reservaciones" ? (
              (reservations ?? []).length === 0 ? (
                <EmptyState
                  icon={Calendar}
                  title="Sin reservaciones todavía"
                  text="Cuando el cliente reserve una clase aparecerá aquí, con su asistencia y lugar."
                />
              ) : (
                <div className="space-y-1.5">
                  {(reservations ?? []).map((r) => {
                    const { label, tone } = bookingStatusTone(r.status, r.checkin?.status);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 border border-border p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate">
                            {r.cls
                              ? new Intl.DateTimeFormat("es-MX", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                  timeZone: "America/Monterrey",
                                }).format(new Date(r.cls.starts_at))
                              : ""}
                            {r.seat_number ? (
                              <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[0.6rem] text-background">
                                {r.seat_number}
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.cls?.module_key ?? ""} · {r.cls?.room ?? ""}
                          </p>
                        </div>
                        <span
                          className={cn("shrink-0 px-2 py-1 text-[0.62rem]", TONE_CLASSES[tone])}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )
            ) : null}

            {tab === "compras" ? (
              (purchases ?? []).length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Sin compras registradas"
                  text="Aquí verás los paquetes y membresías que el cliente haya pagado."
                  action={
                    <button
                      onClick={() => {
                        setTab("creditos");
                        setShowPackages(true);
                      }}
                      className="bg-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-background"
                    >
                      Vender un paquete
                    </button>
                  }
                />
              ) : (
                <div className="space-y-1.5">
                  {(purchases ?? []).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 border border-border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{t.plan?.name ?? "Compra"}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat("es-MX", {
                            dateStyle: "medium",
                            timeZone: "America/Monterrey",
                          }).format(new Date(t.created_at))}{" "}
                          · {t.payment_method}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {money(t.amount_cents)}
                        <br />+{t.tokens} créditos
                      </span>
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {tab === "creditos" ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-4 border border-border p-6">
                  <div>
                    <p className="eyebrow">Créditos activos</p>
                    <p className="mt-1 text-4xl">{balance ?? 0}</p>
                  </div>
                  <button
                    onClick={() => setShowPackages((v) => !v)}
                    className="bg-foreground px-5 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] text-background"
                  >
                    {showPackages ? "Ocultar paquetes" : "Comprar paquete"}
                  </button>
                </div>

                {showPackages ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {(plans ?? [])
                      .filter((p) => isPlanInSaleWindow(p))
                      .map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-3 border border-border p-3 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {money(p.price_cents)} · {p.tokens} créditos
                            </p>
                          </div>
                          <button
                            onClick={() => setPendingPlan(p)}
                            className="shrink-0 bg-foreground px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.1em] text-background"
                          >
                            Comprar
                          </button>
                        </div>
                      ))}
                    {(plans ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin paquetes publicados.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === "notas" ? (
              <div>
                <p className="mb-4 eyebrow">Notas internas del staff</p>
                <textarea
                  key={profile?.id}
                  defaultValue={profile?.admin_notes ?? ""}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={8}
                  placeholder="Alergias, preferencias, incidentes, lo que sea útil para el equipo…"
                  className={input}
                />
                <button
                  disabled={notesDraft === null || saveNotes.isPending}
                  onClick={() => notesDraft !== null && saveNotes.mutate(notesDraft)}
                  className="mt-3 bg-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-background disabled:opacity-40"
                >
                  Guardar notas
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Columna lateral: contacto, membresía y notas */}
        <aside className="space-y-4">
          <div className="border border-border p-5">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Contacto</p>
              {isAdmin && profile ? (
                <button
                  onClick={() => setEditing(true)}
                  className="text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                >
                  Editar
                </button>
              ) : null}
            </div>
            <div className="mt-1 divide-y divide-border">
              <InfoRow
                icon={Mail}
                label="Correo"
                value={
                  profile?.email ? (
                    <a href={`mailto:${profile.email}`} className="hover:underline">
                      {profile.email}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <InfoRow
                icon={Phone}
                label="Teléfono"
                value={
                  profile?.phone ? (
                    <a href={`tel:${profile.phone}`} className="hover:underline">
                      {profile.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Sin teléfono</span>
                  )
                }
              />
            </div>
          </div>

          <MembershipStatusCard userId={clientId} staffView />
          <CreditLotsSummary userId={clientId} />

          <div className="border border-border p-5">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Notas</p>
              <button
                onClick={() => setTab("notas")}
                className="text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                {profile?.admin_notes ? "Ver" : "Agregar"}
              </button>
            </div>
            <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">
              {profile?.admin_notes || "Sin notas del staff."}
            </p>
          </div>
        </aside>
      </div>

      {pendingPlan ? (
        <ProfilePlanCheckout
          clientId={clientId}
          plan={pendingPlan}
          onClose={() => setPendingPlan(null)}
          onPaid={() => {
            setPendingPlan(null);
            setShowPackages(false);
            setTab("compras");
          }}
        />
      ) : null}

      {editing && profile ? (
        <EditClientPopout
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refreshProfile();
          }}
        />
      ) : null}

      {deleting && profile ? (
        <DeleteClientPopout
          profile={profile}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// PAQUETES (token_plans) — class packages, memberships, Align, Contrast.
// ============================================================================
const CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Clases de Pilates",
  membresia: "Membresías",
  consulta: "Align (consulta)",
  recuperacion: "Contrast (recuperación)",
  convenio: "Convenios corporativos",
};

// ============================================================================
// GODDE'S — productos de la marca aliada, SOLO se venden en persona (nunca
// en la página web). Se guardan con brand='goodes' (identificador interno), no
// con la categoría 'merch', así jamás aparecen en /merch ni en la Tienda de /app aunque
// alguien active la casilla "Publicado" por error.
// ============================================================================
export function GoodesPanel() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-goodes"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- brand no está en los tipos generados todavía
      const { data, error } = await (supabase.from("products").select as any)("*")
        .eq("brand", "goodes")
        .order("name");
      if (error) throw error;
      return data as (Tables<"products"> & { description?: string; brand?: string })[];
    },
  });

  const save = useMutation({
    mutationFn: async (row: {
      id?: string;
      name: string;
      price_cents: number;
      stock: number;
      description: string;
      active: boolean;
      image_url: string | null;
    }) => {
      const payload = {
        name: row.name,
        price_cents: row.price_cents,
        stock: row.stock,
        description: row.description,
        active: row.active,
        image_url: row.image_url,
        category: "goodes",
        brand: "goodes",
      };
      if (row.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- brand/description no están en los tipos generados
        const { error } = await (supabase.from("products").update as any)(payload).eq("id", row.id);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- brand/description no están en los tipos generados
        const { error } = await (supabase.from("products").insert as any)(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Producto de Goddess guardado.");
      setEditingId(null);
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ["admin-goodes"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto eliminado.");
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["admin-goodes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Goddess</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Productos de la marca Goddess — solo se venden en el mostrador, en la terminal de Clip de
          Goddess. Nunca aparecen en la página web ni en la app.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] hover:bg-muted"
      >
        + Agregar producto de Goddess
      </button>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((p) => (
          <div key={p.id} className="border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{money(p.price_cents)}</p>
              </div>
              <span
                className={`shrink-0 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] ${
                  p.active ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {p.active ? "Activo" : "Oculto"}
              </span>
            </div>
            {p.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">Stock: {p.stock}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditingId(p.id)}
                className="flex-1 border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) {
                    remove.mutate(p.id);
                  }
                }}
                className="border border-destructive px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-destructive hover:bg-destructive hover:text-background"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin productos de Goddess todavía.</p>
        ) : null}
      </div>

      {creating || editingId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
          <div className="w-full max-w-xl bg-background shadow-2xl">
            <MerchEditCard
              product={editingId ? ((data ?? []).find((p) => p.id === editingId) ?? null) : null}
              withPhoto={false}
              activeLabel="Disponible en el punto de venta"
              onCancel={() => {
                setCreating(false);
                setEditingId(null);
              }}
              onSave={(row) => save.mutate(editingId ? { ...row, id: editingId } : row)}
              {...(editingId
                ? {
                    onDelete: () => {
                      if (confirm("¿Eliminar este producto?")) remove.mutate(editingId);
                    },
                  }
                : {})}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MerchPanel() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-merch"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("category", "merch")
        .order("name");
      if (error) throw error;
      return data as (Tables<"products"> & { description?: string })[];
    },
  });

  const save = useMutation({
    mutationFn: async (row: {
      id?: string;
      name: string;
      price_cents: number;
      stock: number;
      description: string;
      active: boolean;
      image_url: string | null;
    }) => {
      const payload = {
        name: row.name,
        price_cents: row.price_cents,
        stock: row.stock,
        description: row.description,
        active: row.active,
        image_url: row.image_url,
        category: "merch",
      };
      if (row.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "description" no está en los tipos generados todavía
        const { error } = await (supabase.from("products").update as any)(payload).eq("id", row.id);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "description" no está en los tipos generados todavía
        const { error } = await (supabase.from("products").insert as any)(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Producto guardado.");
      setEditingId(null);
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ["admin-merch"] });
      void qc.invalidateQueries({ queryKey: ["merch-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto eliminado.");
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["admin-merch"] });
      void qc.invalidateQueries({ queryKey: ["merch-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Merch</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Lo que edites aquí (foto, precio, descripción, activo/inactivo) se refleja directo en{" "}
          <span className="font-mono">/merch</span>, la tienda pública.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] hover:bg-muted"
      >
        + Agregar producto
      </button>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((p) => (
          <div key={p.id} className="border border-border p-4">
            <div className="flex aspect-square items-center justify-center bg-muted">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <p className="px-4 text-center text-xs text-muted-foreground">Sin foto</p>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{money(p.price_cents)}</p>
              </div>
              <span
                className={`shrink-0 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] ${
                  p.active ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {p.active ? "Publicado" : "Oculto"}
              </span>
            </div>
            {p.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">Stock: {p.stock}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditingId(p.id)}
                className="flex-1 border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) {
                    remove.mutate(p.id);
                  }
                }}
                className="border border-destructive px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-destructive hover:bg-destructive hover:text-background"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin productos de Merch todavía.</p>
        ) : null}
      </div>

      {creating || editingId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
          <div className="w-full max-w-xl bg-background shadow-2xl">
            <MerchEditCard
              product={editingId ? ((data ?? []).find((p) => p.id === editingId) ?? null) : null}
              onCancel={() => {
                setCreating(false);
                setEditingId(null);
              }}
              onSave={(row) => save.mutate(editingId ? { ...row, id: editingId } : row)}
              {...(editingId
                ? {
                    onDelete: () => {
                      if (confirm("¿Eliminar este producto?")) remove.mutate(editingId);
                    },
                  }
                : {})}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MerchEditCard({
  product,
  onCancel,
  onSave,
  onDelete,
  withPhoto = true,
  activeLabel = "Publicado en /merch",
}: {
  product: (Tables<"products"> & { description?: string }) | null;
  withPhoto?: boolean;
  activeLabel?: string;
  onCancel: () => void;
  onDelete?: () => void;
  onSave: (row: {
    name: string;
    price_cents: number;
    stock: number;
    description: string;
    active: boolean;
    image_url: string | null;
  }) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
      const { error } = await supabase.storage.from("product-photos").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("product-photos").getPublicUrl(path);
      setImageUrl(data.publicUrl);
      toast.success("Foto subida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la foto.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      className="border border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          name: String(f.get("name") || ""),
          price_cents: Math.round(Number(f.get("price") || 0) * 100),
          stock: Number(f.get("stock") || 0),
          description: String(f.get("description") || ""),
          active: f.get("active") === "on",
          image_url: imageUrl,
        });
      }}
    >
      <div className={cn("grid gap-4", withPhoto && "sm:grid-cols-2")}>
        {withPhoto ? (
          <div>
            <span className="eyebrow">Foto</span>
            <div className="mt-2 flex aspect-square items-center justify-center bg-muted">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <p className="px-4 text-center text-xs text-muted-foreground">Sin foto todavía</p>
              )}
            </div>
            <label className="mt-2 block">
              <span className="sr-only">Subir foto</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="w-full text-xs"
              />
            </label>
            {uploading ? <p className="mt-1 text-xs text-muted-foreground">Subiendo…</p> : null}
          </div>
        ) : null}

        <div className="space-y-3">
          <label className="block text-xs">
            <span className="eyebrow">Nombre</span>
            <input name="name" defaultValue={product?.name ?? ""} required className={input} />
          </label>
          <label className="block text-xs">
            <span className="eyebrow">Precio (MXN)</span>
            <input
              name="price"
              type="number"
              step="0.01"
              min="0"
              defaultValue={product ? (product.price_cents / 100).toFixed(2) : ""}
              required
              className={input}
            />
          </label>
          <label className="block text-xs">
            <span className="eyebrow">Stock</span>
            <input
              name="stock"
              type="number"
              min="0"
              defaultValue={product?.stock ?? 0}
              required
              className={input}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="active" defaultChecked={product?.active ?? true} />
            <span className="eyebrow">{activeLabel}</span>
          </label>
        </div>
      </div>

      <label className="mt-4 block text-xs">
        <span className="eyebrow">
          {withPhoto ? "Descripción (se ve en la tienda pública)" : "Descripción (opcional)"}
        </span>
        <textarea
          name="description"
          rows={3}
          defaultValue={product?.description ?? ""}
          className={`${input} resize-none`}
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-input px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={uploading}
          className="flex-1 bg-foreground px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] text-background disabled:opacity-50"
        >
          Guardar
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="w-full border border-destructive px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] text-destructive hover:bg-destructive hover:text-background"
          >
            Eliminar producto
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function PackagesPanel({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-packages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("token_plans").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof data>>();
    for (const p of data ?? []) {
      groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    }
    return Array.from(groups.entries());
  }, [data]);

  const openPlan = data?.find((p) => p.id === openId);

  return (
    <div className="space-y-8">
      {readOnly ? (
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Solo lectura — pide a un admin que haga cambios aquí.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] hover:bg-muted"
        >
          + Agregar paquete
        </button>
      )}

      {grouped.map(([category, items]) => (
        <div key={category}>
          <p className="mb-3 eyebrow">{CATEGORY_LABELS[category] ?? category}</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) =>
              readOnly ? (
                <div
                  key={p.id}
                  className={`border p-4 text-left ${p.active ? "border-border" : "border-border opacity-45"}`}
                >
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {money(p.price_cents)} · {p.tokens} créditos
                  </p>
                  {!p.active ? (
                    <p className="mt-1 text-[0.6rem] text-muted-foreground">Oculto</p>
                  ) : null}
                </div>
              ) : (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className={`border p-4 text-left hover:border-foreground/40 ${p.active ? "border-border" : "border-border opacity-45"}`}
                >
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {money(p.price_cents)} · {p.tokens} créditos
                  </p>
                  {!p.active ? (
                    <p className="mt-1 text-[0.6rem] text-muted-foreground">Oculto</p>
                  ) : null}
                </button>
              ),
            )}
          </div>
        </div>
      ))}
      {grouped.length === 0 ? <p className="text-muted-foreground">Sin paquetes todavía.</p> : null}

      {!readOnly && openPlan ? (
        <PackageEditPopout plan={openPlan} onClose={() => setOpenId(null)} />
      ) : null}
      {!readOnly && creating ? (
        <PackageEditPopout plan={null} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

type CouponRow = {
  id: string;
  code: string;
  kind: string;
  reward_tokens: number;
  max_uses: number | null;
  max_uses_per_user?: number | null;
  new_clients_only?: boolean;
  times_used: number;
  active: boolean;
};

function CouponRedemptionsRow({ couponId }: { couponId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["coupon-redemptions", couponId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coupon_redemptions no está en los tipos generados
      const { data: redemptions, error } = await (supabase.from as any)("coupon_redemptions")
        .select("id, user_id, created_at")
        .eq("coupon_id", couponId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const userIds = (redemptions ?? []).map((r: { user_id: string }) => r.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [] as { id: string; full_name: string; email: string }[] };
      return (redemptions ?? []).map((r: { id: string; user_id: string; created_at: string }) => ({
        ...r,
        profile: profiles?.find((p) => p.id === r.user_id),
      }));
    },
  });

  return (
    <tr className="border-b border-border bg-muted/30 last:border-0">
      <td colSpan={8} className="px-4 py-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : (data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nadie ha usado este cupón todavía.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {(data ?? []).map(
              (r: {
                id: string;
                created_at: string;
                profile?: { full_name: string; email: string };
              }) => (
                <li key={r.id} className="flex items-center justify-between gap-4">
                  <span>{r.profile?.full_name || r.profile?.email || "Cliente"}</span>
                  <span className="text-muted-foreground">
                    {new Intl.DateTimeFormat("es-MX", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(r.created_at))}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// Solicitudes de membresía: como Clip no tiene API de suscripciones, una
// membresía comprada en línea no se cobra sola -- el cliente manda una
// solicitud, el staff la inscribe a mano en Pagos Recurrentes de Clip, y
// aquí la marca como completada para que se activen sus créditos.
// ============================================================================
export function MembershipRequestsPanel() {
  const qc = useQueryClient();
  const { staffProfile } = useAuth();
  const [filter, setFilter] = useState<"pendiente" | "todas">("pendiente");

  const { data } = useQuery({
    queryKey: ["membership-requests"],
    queryFn: async () => {
      const { data: requests, error } = await (supabase.from as any)("membership_requests")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      const rows = (requests ?? []) as {
        id: string;
        user_id: string;
        plan_id: string;
        status: string;
        requested_at: string;
      }[];
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      const planIds = Array.from(new Set(rows.map((r) => r.plan_id)));
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [] as { id: string; full_name: string; email: string }[] };
      const { data: plans } = planIds.length
        ? await supabase.from("token_plans").select("id, name, price_cents").in("id", planIds)
        : { data: [] as { id: string; name: string; price_cents: number }[] };
      return rows.map((r) => ({
        ...r,
        profile: profiles?.find((p) => p.id === r.user_id),
        plan: plans?.find((p) => p.id === r.plan_id),
      }));
    },
  });

  const complete = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await (supabase.rpc as any)("complete_membership_request", {
        _request_id: requestId,
        _staff_id: staffProfile?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membresía activada.");
      void qc.invalidateQueries({ queryKey: ["membership-requests"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo completar."),
  });

  const visible = (data ?? []).filter((r) =>
    filter === "pendiente" ? r.status === "pendiente" : true,
  );

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Cuando alguien solicita una membresía en línea, aparece aquí. Inscríbela primero en{" "}
        <strong>Pagos Recurrentes</strong> desde el dashboard de Clip (con la tarjeta de la
        persona), y hasta entonces márcala como completada — eso es lo que le da sus créditos en
        Läätu.
      </p>
      <div className="mb-4 flex gap-1.5">
        {(["pendiente", "todas"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] ${filter === f ? "border-foreground bg-foreground text-background" : "border-input"}`}
          >
            {f === "pendiente" ? "Pendientes" : "Todas"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <div key={r.id} className="border border-border p-4">
            <p className="text-sm font-medium">{r.profile?.full_name || r.profile?.email}</p>
            <p className="text-xs text-muted-foreground">{r.profile?.email}</p>
            <p className="mt-2 text-sm">{r.plan?.name}</p>
            <p className="text-xs text-muted-foreground">{money(r.plan?.price_cents ?? 0)} / mes</p>
            <p className="mt-2 text-[0.65rem] text-muted-foreground">
              Solicitada:{" "}
              {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(r.requested_at),
              )}
            </p>
            {r.status === "pendiente" ? (
              <button
                onClick={() => complete.mutate(r.id)}
                disabled={complete.isPending}
                className="mt-3 w-full bg-foreground px-3 py-2 text-[0.62rem] uppercase tracking-[0.1em] text-background disabled:opacity-50"
              >
                Ya la inscribí en Clip — activar
              </button>
            ) : (
              <span className="mt-3 inline-block bg-emerald-500/10 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] text-emerald-700">
                Inscrita
              </span>
            )}
          </div>
        ))}
        {visible.length === 0 ? (
          <p className="col-span-full text-muted-foreground">Sin solicitudes en este filtro.</p>
        ) : null}
      </div>
    </div>
  );
}

export function CouponsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingUsesId, setViewingUsesId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "coupons" no está en los tipos generados (el conector de Supabase de esta sesión no puede regenerarlos contra el proyecto real)
      const { data, error } = await (supabase.from as any)("coupons")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CouponRow[];
    },
  });

  const save = useMutation({
    mutationFn: async (row: Partial<CouponRow> & { id?: string }) => {
      const payload = {
        code: row.code?.trim().toUpperCase(),
        reward_tokens: row.reward_tokens,
        max_uses: row.max_uses,
        max_uses_per_user: row.max_uses_per_user,
        new_clients_only: row.new_clients_only ?? false,
        active: row.active,
      };
      if (row.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "coupons" no está en los tipos generados
        const { error } = await (supabase.from as any)("coupons").update(payload).eq("id", row.id);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- "coupons" no está en los tipos generados
        const { error } = await (supabase.from as any)("coupons").insert({
          ...payload,
          kind: "referido",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Cupón guardado.");
      setEditingId(null);
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e) => toast.error(describeError(e, "No se pudo guardar el cupón.")),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Cupones</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          La clienta escribe el código en su cuenta o en la app ("¿Tienes un cupón?") y recibe las
          clases al instante. Para cada cupón decides cuántas veces se puede usar en total, cuántas
          veces puede usarlo una misma persona (1 = una sola vez) y si es solo para clientes nuevos
          (que nunca han comprado un paquete). Deja un campo vacío para "sin límite".
        </p>
      </div>

      {readOnly ? (
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Solo lectura — pide a un admin que haga cambios aquí.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] hover:bg-muted"
        >
          + Agregar cupón
        </button>
      )}

      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Recompensa</th>
              <th className="px-4 py-3">Límite total</th>
              <th className="px-4 py-3">Por persona</th>
              <th className="px-4 py-3">Solo nuevos</th>
              <th className="px-4 py-3">Usados</th>
              <th className="px-4 py-3">Activo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) =>
              editingId === c.id ? (
                <CouponEditRow
                  key={c.id}
                  coupon={c}
                  onCancel={() => setEditingId(null)}
                  onSave={(row) => save.mutate({ ...row, id: c.id })}
                />
              ) : (
                <Fragment key={c.id}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono">{c.code}</td>
                    <td className="px-4 py-3">{c.reward_tokens} clase(s)</td>
                    <td className="px-4 py-3">{c.max_uses ?? "Ilimitado"}</td>
                    <td className="px-4 py-3">
                      {c.max_uses_per_user === undefined
                        ? "1"
                        : (c.max_uses_per_user ?? "Ilimitado")}
                    </td>
                    <td className="px-4 py-3">{c.new_clients_only ? "Sí" : "No"}</td>
                    <td className="px-4 py-3">{c.times_used}</td>
                    <td className="px-4 py-3">{c.active ? "Sí" : "No"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setViewingUsesId(viewingUsesId === c.id ? null : c.id)}
                        className="mr-4 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
                      >
                        {viewingUsesId === c.id ? "Ocultar usos" : "Ver usos"}
                      </button>
                      {readOnly ? null : (
                        <button
                          type="button"
                          onClick={() => setEditingId(c.id)}
                          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                  {viewingUsesId === c.id ? <CouponRedemptionsRow couponId={c.id} /> : null}
                </Fragment>
              ),
            )}
            {!readOnly && creating ? (
              <CouponEditRow
                coupon={null}
                onCancel={() => setCreating(false)}
                onSave={(row) => save.mutate(row)}
              />
            ) : null}
          </tbody>
        </table>
        {(data ?? []).length === 0 && !creating ? (
          <p className="p-4 text-sm text-muted-foreground">Sin cupones todavía.</p>
        ) : null}
      </div>
    </div>
  );
}

function CouponEditRow({
  coupon,
  onCancel,
  onSave,
}: {
  coupon: CouponRow | null;
  onCancel: () => void;
  onSave: (row: Partial<CouponRow>) => void;
}) {
  const [code, setCode] = useState(coupon?.code ?? "");
  const [rewardTokens, setRewardTokens] = useState(coupon?.reward_tokens ?? 1);
  const [maxUses, setMaxUses] = useState<string>(coupon?.max_uses?.toString() ?? "");
  const [perUser, setPerUser] = useState<string>(
    coupon ? (coupon.max_uses_per_user === null ? "" : String(coupon.max_uses_per_user ?? 1)) : "1",
  );
  const [newOnly, setNewOnly] = useState(coupon?.new_clients_only ?? false);
  const [active, setActive] = useState(coupon?.active ?? true);

  return (
    <tr className="border-b border-border bg-muted/30 last:border-0">
      <td className="px-4 py-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="CODIGO"
          className={input}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          value={rewardTokens}
          onChange={(e) => setRewardTokens(Number(e.target.value))}
          className={input}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          placeholder="Ilimitado"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          className={input}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          placeholder="Ilimitado"
          value={perUser}
          onChange={(e) => setPerUser(e.target.value)}
          className={input}
        />
      </td>
      <td className="px-4 py-3">
        <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
      </td>
      <td className="px-4 py-3 text-muted-foreground">{coupon?.times_used ?? 0}</td>
      <td className="px-4 py-3">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                code,
                reward_tokens: rewardTokens,
                max_uses: maxUses.trim() === "" ? null : Number(maxUses),
                max_uses_per_user: perUser.trim() === "" ? null : Number(perUser),
                new_clients_only: newOnly,
                active,
              })
            }
            className="bg-foreground px-3 py-1.5 text-xs uppercase tracking-wide text-background"
          >
            Guardar
          </button>
        </div>
      </td>
    </tr>
  );
}

function mtyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey" }).format(new Date(iso));
}

function PackageEditPopout({
  plan,
  onClose,
}: {
  plan: Tables<"token_plans"> | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isNew = !plan;

  const save = useMutation({
    mutationFn: async (payload: TablesInsert<"token_plans">) => {
      if (plan) {
        const { error } = await supabase.from("token_plans").update(payload).eq("id", plan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("token_plans").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isNew ? "Paquete creado." : "Paquete actualizado.");
      void qc.invalidateQueries({ queryKey: ["admin-packages"] });
      onClose();
    },
    onError: () => toast.error("No se pudo guardar el paquete."),
  });

  const toggleActive = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      const { error } = await supabase
        .from("token_plans")
        .update({ active: !plan.active })
        .eq("id", plan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Visibilidad actualizada.");
      void qc.invalidateQueries({ queryKey: ["admin-packages"] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      const { error } = await supabase.from("token_plans").delete().eq("id", plan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Paquete borrado.");
      void qc.invalidateQueries({ queryKey: ["admin-packages"] });
      onClose();
    },
    onError: () => toast.error("No se pudo borrar (¿tiene compras asociadas? Mejor ocúltalo)."),
  });

  return (
    <Popout onClose={onClose}>
      <p className="mb-4 eyebrow">{isNew ? "Nuevo paquete" : "Editar paquete"}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            name: String(f.get("name") || ""),
            subtitle: String(f.get("subtitle") || ""),
            description: String(f.get("description") || ""),
            category: String(f.get("category") || "clases_pilates"),
            price_cents: Math.round(Number(f.get("price") || 0) * 100),
            tokens: Math.max(0, Number(f.get("tokens") || 0)),
            daily_class_limit: f.get("daily_class_limit")
              ? Number(f.get("daily_class_limit"))
              : null,
            max_sales: f.get("max_sales") ? Number(f.get("max_sales")) : null,
            // Fechas en hora de Monterrey (UTC-6, sin horario de verano).
            available_from: f.get("available_from")
              ? `${f.get("available_from")}T00:00:00-06:00`
              : null,
            available_until: f.get("available_until")
              ? `${f.get("available_until")}T23:59:59-06:00`
              : null,
            membership_starts_at: f.get("membership_starts_at")
              ? `${f.get("membership_starts_at")}T00:00:00-06:00`
              : null,
            recurring: f.get("recurring") === "on",
            validity_days: f.get("validity_days") ? Number(f.get("validity_days")) : null,
            includes: String(f.get("includes") || ""),
            terms: String(f.get("terms") || ""),
            active: plan ? plan.active : true,
            sort_order: plan?.sort_order ?? 0,
          } as unknown as TablesInsert<"token_plans">);
        }}
      >
        <label className="block text-xs">
          <span className="eyebrow">Nombre</span>
          <input name="name" defaultValue={plan?.name} required className={input} />
        </label>
        <label className="block text-xs">
          <span className="eyebrow">Subtítulo</span>
          <input name="subtitle" defaultValue={plan?.subtitle} className={input} />
        </label>
        <label className="block text-xs">
          <span className="eyebrow">Descripción</span>
          <textarea
            name="description"
            defaultValue={plan?.description}
            rows={2}
            className={input}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-xs">
            <span className="eyebrow">Categoría</span>
            <select
              name="category"
              defaultValue={plan?.category ?? "clases_pilates"}
              className={input}
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Vigencia (días)</span>
            <input
              name="validity_days"
              type="number"
              defaultValue={plan?.validity_days ?? ""}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Precio (MXN)</span>
            <input
              name="price"
              type="number"
              step="0.01"
              defaultValue={plan ? plan.price_cents / 100 : ""}
              required
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Créditos</span>
            <input
              name="tokens"
              type="number"
              defaultValue={plan?.tokens ?? 1}
              required
              className={input}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
          <label className="text-xs">
            <span className="eyebrow">Clases por día (membresía)</span>
            <input
              name="daily_class_limit"
              type="number"
              min={1}
              defaultValue={plan?.daily_class_limit ?? ""}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Cupo total (vacío = sin límite)</span>
            <input
              name="max_sales"
              type="number"
              min={1}
              defaultValue={plan?.max_sales ?? ""}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Venta desde</span>
            <input
              name="available_from"
              type="date"
              defaultValue={mtyDate(plan?.available_from)}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Venta hasta (23:59)</span>
            <input
              name="available_until"
              type="date"
              defaultValue={mtyDate(plan?.available_until)}
              className={input}
            />
          </label>
          <label className="col-span-2 text-xs">
            <span className="eyebrow">La vigencia empieza a contar desde (opcional)</span>
            <input
              name="membership_starts_at"
              type="date"
              defaultValue={mtyDate(plan?.membership_starts_at)}
              className={input}
            />
          </label>
          <p className="col-span-2 text-[0.65rem] text-muted-foreground">
            Si alguien compra antes de la fecha de inicio, sus días empiezan a correr desde esa
            fecha y no desde el día del pago.
          </p>
          <p className="col-span-2 text-[0.65rem] text-muted-foreground">
            Fuera de estas fechas o al llenarse el cupo, se oculta sola de la web y del POS. Para
            reabrir una promoción, pon fechas nuevas y usa "Publicar".
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="recurring" defaultChecked={plan?.recurring} />
          Cargo mensual recurrente
        </label>
        <label className="block text-xs">
          <span className="eyebrow">Incluye (una línea por elemento)</span>
          <textarea name="includes" defaultValue={plan?.includes} rows={3} className={input} />
        </label>
        <label className="block text-xs">
          <span className="eyebrow">Términos y condiciones</span>
          <textarea name="terms" defaultValue={plan?.terms} rows={2} className={input} />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex gap-2">
            {!isNew ? (
              <>
                <button
                  type="button"
                  onClick={() => toggleActive.mutate()}
                  className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em]"
                >
                  {plan?.active ? "Ocultar" : "Publicar"}
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-destructive"
                >
                  Borrar
                </button>
              </>
            ) : null}
          </div>
          <button className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
            Guardar
          </button>
        </div>
      </form>
    </Popout>
  );
}

// ============================================================================
// NÓMINA
// ============================================================================
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export function PayrollPanel() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(() => startOfWeek(new Date()).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);

  const { data: staff } = useQuery({
    queryKey: ["payroll-staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*")
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: hoursRows } = useQuery({
    queryKey: ["payroll-hours", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_period_hours")
        .select("*")
        .eq("period_start", from)
        .eq("period_end", to);
      if (error) throw error;
      return data;
    },
  });

  const { data: allTiers } = useQuery({
    queryKey: ["payroll-coach-tiers"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { data, error } = await (supabase.from as any)("coach_rate_tiers")
        .select("*")
        .order("min_attendance");
      if (error) throw error;
      return data as { coach_id: string; min_attendance: number; rate_cents: number }[];
    },
  });

  const coachIdsWithTiers = useMemo(
    () => new Set((allTiers ?? []).map((t) => t.coach_id)),
    [allTiers],
  );

  const { data: coachClasses } = useQuery({
    queryKey: ["payroll-coach-classes", from, to, Array.from(coachIdsWithTiers).join(",")],
    enabled: coachIdsWithTiers.size > 0,
    queryFn: async () => {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data: classesData, error } = await supabase
        .from("classes")
        .select("id, coach_id")
        .in("coach_id", Array.from(coachIdsWithTiers))
        .gte("starts_at", fromIso)
        .lt("starts_at", toIso);
      if (error) throw error;
      const classIds = (classesData ?? []).map((c) => c.id);
      const { data: bookings } = classIds.length
        ? await supabase
            .from("bookings")
            .select("class_id")
            .eq("status", "reservada")
            .in("class_id", classIds)
        : { data: [] as { class_id: string }[] };
      const attendanceByClass = new Map<string, number>();
      for (const b of bookings ?? []) {
        attendanceByClass.set(b.class_id, (attendanceByClass.get(b.class_id) ?? 0) + 1);
      }
      return (classesData ?? []).map((c) => ({
        coach_id: c.coach_id as string,
        attendance: attendanceByClass.get(c.id) ?? 0,
      }));
    },
  });

  // Precio fijo por clase: el rango con el min_attendance más alto que no
  // se pase de la asistencia real de esa clase.
  const tierRateFor = (coachId: string, attendance: number) => {
    const tiers = (allTiers ?? [])
      .filter((t) => t.coach_id === coachId)
      .sort((a, b) => a.min_attendance - b.min_attendance);
    let rate = 0;
    for (const t of tiers) {
      if (attendance >= t.min_attendance) rate = t.rate_cents;
    }
    return rate;
  };

  const rows = useMemo(() => {
    return (staff ?? []).map((s) => {
      const hasTiers = coachIdsWithTiers.has(s.id);
      if (hasTiers) {
        const classesForCoach = (coachClasses ?? []).filter((c) => c.coach_id === s.id);
        const base = classesForCoach.reduce((sum, c) => sum + tierRateFor(s.id, c.attendance), 0);
        return {
          staff: s,
          hours: classesForCoach.length,
          base,
          hasUpload: true,
          byOccupancy: true,
        };
      }
      const hoursRow = (hoursRows ?? []).find((h) => h.staff_id === s.id);
      const hours = hoursRow?.hours ?? 0;
      const base = Math.round(hours * s.hourly_rate_cents);
      return { staff: s, hours, base, hasUpload: Boolean(hoursRow), byOccupancy: false };
    });
  }, [staff, hoursRows, coachClasses, coachIdsWithTiers, allTiers]);

  const { data: adjustmentsByStaff } = useQuery({
    queryKey: ["payroll-adjustments", from, to],
    queryFn: async () => {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("payroll_adjustments")
        .select("*")
        .gte("created_at", fromIso)
        .lt("created_at", toIso);
      if (error) throw error;
      const map = new Map<string, typeof data>();
      for (const a of data ?? []) {
        map.set(a.staff_id, [...(map.get(a.staff_id) ?? []), a]);
      }
      return map;
    },
  });

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const sheetData = [
      ["Nombre", "Correo", "Horas"],
      ...(staff ?? []).map((s) => [s.full_name, s.email ?? "", ""]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!cols"] = [{ wch: 28 }, { wch: 30 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Horas");
    XLSX.writeFile(wb, `laatu-horas_${from}_a_${to}.xlsx`);
  };

  const uploadTemplate = useMutation({
    mutationFn: async (file: File) => {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("El Excel no tiene hojas.");
      const rows = XLSX.utils.sheet_to_json<{ Nombre?: string; Correo?: string; Horas?: number }>(
        sheet,
      );
      const unmatched: string[] = [];
      const upserts: {
        staff_id: string;
        period_start: string;
        period_end: string;
        hours: number;
      }[] = [];
      for (const row of rows) {
        const email = String(row.Correo ?? "")
          .trim()
          .toLowerCase();
        const name = String(row.Nombre ?? "")
          .trim()
          .toLowerCase();
        const hours = Number(row.Horas ?? 0);
        const match = (staff ?? []).find(
          (s) =>
            (s.email ?? "").toLowerCase() === email || s.full_name.trim().toLowerCase() === name,
        );
        if (!match) {
          if (email || name) unmatched.push(row.Nombre || row.Correo || "?");
          continue;
        }
        upserts.push({ staff_id: match.id, period_start: from, period_end: to, hours });
      }
      if (upserts.length > 0) {
        const { error } = await supabase
          .from("payroll_period_hours")
          .upsert(upserts, { onConflict: "staff_id,period_start,period_end" });
        if (error) throw error;
      }
      return { matched: upserts.length, unmatched };
    },
    onSuccess: ({ matched, unmatched }) => {
      toast.success(
        `${matched} persona${matched === 1 ? "" : "s"} actualizadas.` +
          (unmatched.length ? ` No se encontró: ${unmatched.join(", ")}.` : ""),
      );
      void qc.invalidateQueries({ queryKey: ["payroll-hours", from, to] });
    },
    onError: () => toast.error("No se pudo leer el Excel. Usa la plantilla descargada."),
  });

  const addAdjustment = useMutation({
    mutationFn: async ({
      staffId,
      amount,
      reason,
    }: {
      staffId: string;
      amount: number;
      reason: string;
    }) => {
      const { error } = await supabase
        .from("payroll_adjustments")
        .insert({ staff_id: staffId, amount_cents: Math.round(amount * 100), reason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste registrado.");
      void qc.invalidateQueries({ queryKey: ["payroll-adjustments", from, to] });
    },
  });

  const rowsWithAdjustments = rows.map((r) => {
    const adjustments = adjustmentsByStaff?.get(r.staff.id) ?? [];
    const adjTotal = adjustments.reduce((sum, a) => sum + a.amount_cents, 0);
    return { ...r, adjustments, adjTotal, total: r.base + adjTotal };
  });

  const [roleFilter, setRoleFilter] = useState<"todos" | "coach" | "staff">("todos");
  const [openStaffId, setOpenStaffId] = useState<string | null>(null);

  const filteredRows = rowsWithAdjustments.filter((r) =>
    roleFilter === "todos" ? true : r.staff.role === roleFilter,
  );

  const grandTotal = rowsWithAdjustments.reduce((sum, r) => sum + r.total, 0);
  const openRow = filteredRows.find((r) => r.staff.id === openStaffId);

  return (
    <div>
      <details className="mb-6 border border-border p-6">
        <summary className="cursor-pointer eyebrow">¿Cómo se calcula? Ver un ejemplo</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="border border-border p-4">
            <p className="eyebrow">1. Horas trabajadas</p>
            <p className="mt-1 text-muted-foreground">
              Se capturan subiendo el Excel de horas del periodo (plantilla descargable abajo).
            </p>
          </div>
          <div className="border border-border p-4">
            <p className="eyebrow">2. Tarifa por hora</p>
            <p className="mt-1 text-muted-foreground">
              La capturada en el perfil de esa persona en Staff.
            </p>
          </div>
          <div className="border border-foreground p-4">
            <p className="eyebrow">3. Total del periodo</p>
            <p className="mt-1 text-muted-foreground">
              Horas × tarifa + ajustes (bonos, descuentos por no-show, etc.) que agregues a mano.
            </p>
          </div>
        </div>
      </details>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border border-border p-6">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs">
            <span className="eyebrow">Desde</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Hasta</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={input}
            />
          </label>
          <button
            type="button"
            onClick={() => void downloadTemplate()}
            className="border border-input px-3 py-2 text-[0.68rem] uppercase tracking-[0.14em]"
          >
            Descargar plantilla
          </button>
          <label className="border border-input px-3 py-2 text-[0.68rem] uppercase tracking-[0.14em] cursor-pointer">
            {uploading ? "Subiendo…" : "Subir Excel de horas"}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                await uploadTemplate.mutateAsync(file).finally(() => setUploading(false));
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="text-right">
          <p className="eyebrow">Total del periodo</p>
          <p className="text-2xl">{money(grandTotal)}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5">
        {(["todos", "coach", "staff"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter(r)}
            className={`border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] ${roleFilter === r ? "border-foreground bg-foreground text-background" : "border-input"}`}
          >
            {r === "todos" ? "Todos" : r === "coach" ? "Coaches" : "Staff"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filteredRows.map((r) => (
          <button
            key={r.staff.id}
            type="button"
            onClick={() => setOpenStaffId(r.staff.id)}
            className="border border-border p-4 text-left hover:border-foreground/40"
          >
            <p className="truncate text-sm font-medium">{r.staff.full_name}</p>
            <p className="text-xs text-muted-foreground">{r.staff.role}</p>
            <p className="mt-2 text-lg">{money(r.total)}</p>
            <p className="text-[0.65rem] text-muted-foreground">
              {r.byOccupancy
                ? `${r.hours} ${r.hours === 1 ? "clase" : "clases"} · por ocupación`
                : r.hasUpload
                  ? `${r.hours.toFixed(1)} h`
                  : "Sin horas subidas"}
            </p>
          </button>
        ))}
        {filteredRows.length === 0 ? (
          <p className="col-span-full text-muted-foreground">Nadie en este filtro.</p>
        ) : null}
      </div>

      {openRow ? (
        <Popout onClose={() => setOpenStaffId(null)}>
          <p className="mb-1 eyebrow">{openRow.staff.role}</p>
          <p className="text-lg font-medium">{openRow.staff.full_name}</p>
          <p className="text-sm text-muted-foreground">{openRow.staff.email}</p>

          <div className="mt-4 border border-border p-4">
            <p className="text-muted-foreground">
              {openRow.hasUpload ? (
                <>
                  {openRow.hours.toFixed(1)} h capturadas · {money(openRow.staff.hourly_rate_cents)}
                  /h → {money(openRow.base)}
                </>
              ) : (
                "Sin horas subidas para este periodo todavía."
              )}
            </p>
            <p className="mt-2 text-xl">{money(openRow.total)}</p>
          </div>

          {openRow.adjustments.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {openRow.adjustments.map((a) => (
                <li key={a.id}>
                  {a.amount_cents >= 0 ? "+" : ""}
                  {money(a.amount_cents)} — {a.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              addAdjustment.mutate({
                staffId: openRow.staff.id,
                amount: Number(f.get("amount") || 0),
                reason: String(f.get("reason") || ""),
              });
              e.currentTarget.reset();
            }}
          >
            <input
              name="amount"
              type="number"
              step="0.01"
              placeholder="+/- MXN"
              className={`${input} w-28`}
            />
            <input
              name="reason"
              placeholder="Motivo (ej. no-show, bono)"
              className={`${input} flex-1`}
            />
            <button className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em]">
              Agregar ajuste
            </button>
          </form>
        </Popout>
      ) : null}
    </div>
  );
}

// ============================================================================
// TURNOS: calendario mensual con cobertura por día
//   - cada turno (mañana/tarde) necesita "spots_needed" personas
//   - verde = cubierto, amarillo = falta cubrir, rojo = casi nadie confirmado
// ============================================================================
type ShiftSlot = Tables<"shift_slots">;
type ShiftClaim = Tables<"shift_claims"> & { staff?: { full_name: string } | null };

function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 domingo
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayCoverage(date: Date, slots: ShiftSlot[], claims: ShiftClaim[]) {
  const daySlots = slots.filter((s) => s.weekday === date.getDay() && s.active);
  if (daySlots.length === 0) return { color: "none" as const, slots: [] };
  const key = dateKey(date);
  const perSlot = daySlots.map((s) => {
    const slotClaims = claims.filter((c) => c.shift_slot_id === s.id && c.for_date === key);
    const confirmed = slotClaims.filter((c) => c.status === "confirmado").length;
    let color: "green" | "yellow" | "red";
    if (confirmed >= s.spots_needed) color = "green";
    else if (confirmed > 0) color = "yellow";
    else color = "red";
    return { slot: s, claims: slotClaims, confirmed, color };
  });
  const color = perSlot.some((p) => p.color === "red")
    ? "red"
    : perSlot.some((p) => p.color === "yellow")
      ? "yellow"
      : "green";
  return { color, slots: perSlot };
}

// Celda completa del calendario coloreada según cobertura del día
// (verde = cubierto, amarillo = falta cubrir, rojo = casi nadie confirmado).
const COVERAGE_CELL: Record<string, string> = {
  green: "border-emerald-500 bg-emerald-500/15 text-emerald-900 dark:text-emerald-300",
  yellow: "border-amber-400 bg-amber-400/15 text-amber-900 dark:text-amber-300",
  red: "border-destructive bg-destructive/10 text-destructive",
  none: "border-border",
};

function useMonthCursor() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  return {
    cursor,
    prev: () =>
      setCursor((c) =>
        c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 },
      ),
    next: () =>
      setCursor((c) =>
        c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 },
      ),
  };
}

export function ShiftSchedulePanel() {
  const qc = useQueryClient();
  const { cursor, prev, next } = useMonthCursor();
  const [selected, setSelected] = useState<Date>(new Date());

  const { data: slots } = useQuery({
    queryKey: ["admin-shift-slots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_slots")
        .select("*")
        .order("weekday")
        .order("start_time");
      if (error) throw error;
      return data;
    },
  });

  const monthStart = new Date(cursor.year, cursor.month, 1);
  const monthEnd = new Date(cursor.year, cursor.month + 1, 0);

  const { data: claims } = useQuery({
    queryKey: ["admin-shift-claims", dateKey(monthStart)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_claims")
        .select("*, staff:staff_profiles(full_name)")
        .gte("for_date", dateKey(monthStart))
        .lte("for_date", dateKey(monthEnd));
      if (error) throw error;
      return data as ShiftClaim[];
    },
  });

  const createSlot = useMutation({
    mutationFn: async (payload: {
      weekday: number;
      start_time: string;
      end_time: string;
      role_needed: "admin" | "staff" | "coach";
      spots_needed: number;
      notes: string;
    }) => {
      const { error } = await supabase.from("shift_slots").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Turno creado.");
      void qc.invalidateQueries({ queryKey: ["admin-shift-slots"] });
    },
  });

  const setClaim = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirmado" | "rechazado" }) => {
      const { error } = await supabase.from("shift_claims").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-shift-claims"] }),
  });

  const cells = monthGrid(cursor.year, cursor.month);
  const selectedCoverage = dayCoverage(selected, slots ?? [], claims ?? []);

  return (
    <div className="space-y-8">
      <details className="border border-border p-6">
        <summary className="cursor-pointer eyebrow">
          Publicar turno requerido (recurrente por día de la semana)
        </summary>
        <form
          className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            createSlot.mutate({
              weekday: Number(f.get("weekday")),
              start_time: String(f.get("start_time")),
              end_time: String(f.get("end_time")),
              role_needed: String(f.get("role_needed")) as "admin" | "staff" | "coach",
              spots_needed: Number(f.get("spots_needed") || 3),
              notes: String(f.get("notes") || ""),
            });
            e.currentTarget.reset();
          }}
        >
          <label className="text-xs">
            <span className="eyebrow">Día</span>
            <select name="weekday" className={input}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Inicio</span>
            <input name="start_time" type="time" required className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Fin</span>
            <input name="end_time" type="time" required className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Rol</span>
            <select name="role_needed" defaultValue="staff" className={input}>
              <option value="staff">Staff</option>
              <option value="coach">Coach</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Spots</span>
            <input
              name="spots_needed"
              type="number"
              min={1}
              max={10}
              defaultValue={3}
              className={input}
            />
          </label>
          <label className="text-xs lg:col-span-2">
            <span className="eyebrow">Notas</span>
            <input name="notes" placeholder="ej. Turno mañana" className={input} />
          </label>
          <div className="col-span-2 sm:col-span-3 lg:col-span-7">
            <button className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
              Publicar
            </button>
          </div>
        </form>
      </details>

      <div className="flex items-center justify-between">
        <button onClick={prev} className="border border-input px-3 py-1.5 text-sm">
          ← Anterior
        </button>
        <p className="eyebrow capitalize">
          {new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(monthStart)}
        </p>
        <button onClick={next} className="border border-input px-3 py-1.5 text-sm">
          Siguiente →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
        {["D", "L", "M", "M", "J", "V", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 border border-emerald-500 bg-emerald-500/15" /> Cubierto
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 border border-amber-400 bg-amber-400/15" /> Falta cubrir
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 border border-destructive bg-destructive/10" /> Casi nadie
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const cov = dayCoverage(date, slots ?? [], claims ?? []);
          const isSelected = dateKey(date) === dateKey(selected);
          return (
            <button
              key={i}
              onClick={() => setSelected(date)}
              className={`flex aspect-square flex-col items-center justify-center border text-sm font-medium transition-colors ${
                COVERAGE_CELL[cov.color]
              } ${isSelected ? "ring-2 ring-inset ring-foreground" : ""}`}
            >
              <span>{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <ShiftDayDetail selected={selected} selectedCoverage={selectedCoverage} setClaim={setClaim} />
    </div>
  );
}

// Detalle del día seleccionado en el calendario de Turnos (solo admin):
// junta la cobertura de staff/coaches con los horarios de clase de ese
// mismo día, para que de un vistazo se vea todo lo que pasa esa fecha.
function ShiftDayDetail({
  selected,
  selectedCoverage,
  setClaim,
}: {
  selected: Date;
  selectedCoverage: ReturnType<typeof dayCoverage>;
  setClaim: { mutate: (vars: { id: string; status: "confirmado" | "rechazado" }) => void };
}) {
  const key = dateKey(selected);
  const { data: dayClasses } = useQuery({
    queryKey: ["shift-day-classes", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .gte("starts_at", `${key}T00:00:00`)
        .lt("starts_at", `${key}T23:59:59`)
        .order("starts_at");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="border border-border p-6">
      <p className="eyebrow">
        {new Intl.DateTimeFormat("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(selected)}
      </p>

      <div className="mt-4">
        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
          Horarios de clase / consultorio este día
        </p>
        {(dayClasses ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Sin clases programadas.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {(dayClasses ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {new Intl.DateTimeFormat("es-MX", { timeStyle: "short" }).format(
                    new Date(c.starts_at),
                  )}{" "}
                  · {c.room} · {c.instructor}
                </span>
                <span className="text-muted-foreground">Cupo {c.capacity}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6">
        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
          Cobertura de staff / coaches
        </p>
        {selectedCoverage.slots.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Sin turnos configurados para este día.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {selectedCoverage.slots.map(({ slot, claims: slotClaims, confirmed, color }) => (
              <div
                key={slot.id}
                className={`border-l-4 pl-4 ${COVERAGE_CELL[color]} border-y-0 border-r-0`}
              >
                <p className="text-sm">
                  {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)} · {slot.role_needed} ·{" "}
                  {confirmed}/{slot.spots_needed} cubiertos
                  {slot.notes ? ` · ${slot.notes}` : ""}
                </p>
                {slotClaims.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Nadie se ha anotado.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {slotClaims.map((c) => (
                      <li key={c.id} className="flex items-center gap-2">
                        <span>{c.staff?.full_name}</span>
                        <span className="text-muted-foreground">{c.status}</span>
                        {c.status === "propuesto" && setClaim ? (
                          <>
                            <button
                              onClick={() => setClaim.mutate({ id: c.id, status: "confirmado" })}
                              className="border border-input px-2 py-0.5"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => setClaim.mutate({ id: c.id, status: "rechazado" })}
                              className="border border-input px-2 py-0.5 text-destructive"
                            >
                              Rechazar
                            </button>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MyAvailabilityPanel() {
  const { staffProfile } = useAuth();
  const qc = useQueryClient();
  const { cursor, prev, next } = useMonthCursor();
  const [selected, setSelected] = useState<Date>(new Date());

  const { data: slots } = useQuery({
    queryKey: ["my-shift-slots", staffProfile?.role],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_slots")
        .select("*")
        .eq("role_needed", staffProfile!.role)
        .eq("active", true)
        .order("weekday");
      if (error) throw error;
      return data;
    },
  });

  const monthStart = new Date(cursor.year, cursor.month, 1);
  const monthEnd = new Date(cursor.year, cursor.month + 1, 0);

  const { data: claims } = useQuery({
    queryKey: ["my-shift-claims", staffProfile?.id, dateKey(monthStart)],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_claims")
        .select("*, staff:staff_profiles(full_name)")
        .gte("for_date", dateKey(monthStart))
        .lte("for_date", dateKey(monthEnd));
      if (error) throw error;
      return data as ShiftClaim[];
    },
  });

  const claim = useMutation({
    mutationFn: async ({ slotId, forDate }: { slotId: string; forDate: string }) => {
      const { error } = await supabase
        .from("shift_claims")
        .insert({ shift_slot_id: slotId, staff_id: staffProfile!.id, for_date: forDate });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Disponibilidad enviada. Espera confirmación del admin.");
      void qc.invalidateQueries({ queryKey: ["my-shift-claims"] });
    },
  });

  const cells = monthGrid(cursor.year, cursor.month);
  const selectedCoverage = dayCoverage(selected, slots ?? [], claims ?? []);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={prev} className="border border-input px-3 py-1.5 text-sm">
          ← Anterior
        </button>
        <p className="eyebrow capitalize">
          {new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(monthStart)}
        </p>
        <button onClick={next} className="border border-input px-3 py-1.5 text-sm">
          Siguiente →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
        {["D", "L", "M", "M", "J", "V", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const cov = dayCoverage(date, slots ?? [], claims ?? []);
          const isSelected = dateKey(date) === dateKey(selected);
          const isPast = date < today;
          return (
            <button
              key={i}
              disabled={isPast}
              onClick={() => setSelected(date)}
              className={`flex aspect-square flex-col items-center justify-center border text-sm font-medium transition-colors disabled:opacity-30 ${
                COVERAGE_CELL[cov.color]
              } ${isSelected ? "ring-2 ring-inset ring-foreground" : ""}`}
            >
              <span>{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="border border-border p-6">
        <p className="eyebrow">
          {new Intl.DateTimeFormat("es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(selected)}
        </p>
        {selectedCoverage.slots.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hay turnos de tu rol este día.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {selectedCoverage.slots.map(({ slot, claims: slotClaims, confirmed }) => {
              const mine = slotClaims.find((c) => c.staff_id === staffProfile?.id);
              return (
                <div key={slot.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)} · {confirmed}/
                    {slot.spots_needed} cubiertos
                  </span>
                  {mine ? (
                    <span className="text-muted-foreground">{mine.status}</span>
                  ) : (
                    <button
                      onClick={() => claim.mutate({ slotId: slot.id, forDate: dateKey(selected) })}
                      className="border border-input px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em]"
                    >
                      Puedo cubrirlo
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CHECADOR: entrada / salida con foto + ubicación obligatorias
// ============================================================================
export function TimeClockPanel() {
  const { staffProfile } = useAuth();
  const qc = useQueryClient();
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "granted" | "denied"
  >("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationStatus("granted");
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const { data: today } = useQuery({
    queryKey: ["my-clock", staffProfile?.id],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("time_clock_entries")
        .select("*")
        .eq("staff_id", staffProfile!.id)
        .gte("created_at", start.toISOString())
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const punch = useMutation({
    mutationFn: async ({ type, file }: { type: "in" | "out"; file: File }) => {
      if (!coords) throw new Error("Necesitamos tu ubicación para poder checar.");
      const path = `${staffProfile!.id}/${Date.now()}-${type}.jpg`;
      const { error: upErr } = await supabase.storage.from("staff-photos").upload(path, file);
      if (upErr) throw upErr;
      const { error } = await supabase.from("time_clock_entries").insert({
        staff_id: staffProfile!.id,
        type,
        photo_url: path,
        latitude: coords.lat,
        longitude: coords.lng,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.type === "in" ? "Entrada registrada." : "Salida registrada.");
      void qc.invalidateQueries({ queryKey: ["my-clock"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No se pudo registrar. Intenta de nuevo."),
  });

  const lastType = today?.[today.length - 1]?.type;
  const nextType: "in" | "out" = lastType === "in" ? "out" : "in";
  const ready = locationStatus === "granted";

  return (
    <div className="max-w-md space-y-6 border border-border p-6">
      <p className="eyebrow">Checador — {staffProfile?.full_name}</p>

      {locationStatus !== "granted" ? (
        <div className="border border-destructive p-3 text-xs text-destructive">
          {locationStatus === "denied"
            ? "Necesitamos permiso de ubicación para poder checar. Actívalo en tu navegador y recarga esta página."
            : "Solicitando acceso a tu ubicación…"}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Ubicación confirmada.</p>
      )}

      <label className={`block text-xs ${!ready ? "pointer-events-none opacity-50" : ""}`}>
        <span className="eyebrow">
          {nextType === "in" ? "Foto para marcar entrada" : "Foto para marcar salida"} (obligatoria)
        </span>
        <input
          type="file"
          accept="image/*"
          capture="user"
          disabled={!ready}
          className={input}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) punch.mutate({ type: nextType, file });
          }}
        />
      </label>

      <ul className="space-y-1 text-sm text-muted-foreground">
        {(today ?? []).map((t) => (
          <li key={t.id}>
            {t.type === "in" ? "Entrada" : "Salida"} —{" "}
            {new Intl.DateTimeFormat("es-MX", { timeStyle: "short" }).format(
              new Date(t.created_at),
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// FINANZAS — solo administradores: ingresos del mes por categoría,
// costo de nómina y margen resultante.
// ============================================================================
const TOKEN_CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Clases de Pilates",
  membresia: "Membresías",
  consulta: "Consulta (Align)",
  recuperacion: "Recuperación (Contrast)",
};

export function FinancePanel() {
  const now = useMemo(() => new Date(), []);
  const [openCard, setOpenCard] = useState<"tokens" | "merch" | "consumibles" | "nomina" | null>(
    null,
  );
  const [tokenCategoryFilter, setTokenCategoryFilter] = useState<string>("todas");
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, []);
  const defaultTo = useMemo(() => now.toISOString().slice(0, 10), [now]);
  const [rangeFromStr, setRangeFromStr] = useState(defaultFrom);
  const [rangeToStr, setRangeToStr] = useState(defaultTo);

  // Últimas 8 semanas + 2 semanas de proyección (promedio de las últimas 4).
  // El trend semanal siempre termina hoy, independiente del filtro de rango.
  const weeks = useMemo(() => {
    const list: { start: Date; end: Date; label: string }[] = [];
    for (let i = 7; i >= 0; i--) {
      const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      list.push({ start, end, label: `${start.getDate()}/${start.getMonth() + 1}` });
    }
    return list;
  }, [now]);

  // Rango que sí controla el filtro: por default, mes en curso a hoy.
  const monthStart = useMemo(() => {
    const d = new Date(`${rangeFromStr}T00:00:00`);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [rangeFromStr]);
  const rangeEnd = useMemo(() => {
    const d = new Date(`${rangeToStr}T23:59:59.999`);
    return d;
  }, [rangeToStr]);

  const { data } = useQuery({
    queryKey: [
      "finance-month",
      monthStart.toISOString(),
      rangeEnd.toISOString(),
      weeks[0]?.start.toISOString(),
    ],
    queryFn: async () => {
      const fromIso = monthStart.toISOString();
      const toIso = rangeEnd.toISOString();
      const trendFromIso = weeks[0]!.start.toISOString();
      // El fetch tiene que cubrir lo que sea más amplio: las 8 semanas del
      // trend, o el rango de fechas que eligió el usuario.
      const fetchFromIso = new Date(fromIso) < new Date(trendFromIso) ? fromIso : trendFromIso;

      const { data: transactions } = await supabase
        .from("transactions")
        .select(
          "amount_cents, status, created_at, user_id, payment_method, external_ref, plan:token_plans(category, name)",
        )
        .eq("status", "completed")
        .gte("created_at", fetchFromIso)
        .lte("created_at", toIso);

      const tokensByCategory = new Map<string, number>();
      const tokensByPlan = new Map<
        string,
        { name: string; category: string; revenue: number; count: number }
      >();
      let clasesRevenue = 0;
      for (const t of transactions ?? []) {
        if (new Date(t.created_at) < monthStart) continue;
        clasesRevenue += t.amount_cents;
        const cat = t.plan?.category ?? "clases_pilates";
        tokensByCategory.set(cat, (tokensByCategory.get(cat) ?? 0) + t.amount_cents);
        const planName = t.plan?.name ?? "Otro";
        const acc = tokensByPlan.get(planName) ?? {
          name: planName,
          category: cat,
          revenue: 0,
          count: 0,
        };
        acc.revenue += t.amount_cents;
        acc.count += 1;
        tokensByPlan.set(planName, acc);
      }

      const { data: saleItems } = await supabase
        .from("pos_sale_items")
        .select(
          "qty, unit_price_cents, product_id, sale:pos_sales!inner(created_at, user_id, status)",
        )
        .neq("sale.status", "reembolsado")
        .gte("sale.created_at", fetchFromIso)
        .lte("sale.created_at", toIso);
      const productIds = Array.from(
        new Set((saleItems ?? []).map((i) => i.product_id).filter(Boolean)),
      ) as string[];
      const { data: products } = productIds.length
        ? await supabase
            .from("products")
            .select("id, category, cost_cents, name")
            .in("id", productIds)
        : { data: [] as { id: string; category: string; cost_cents: number; name: string }[] };
      const productById = new Map((products ?? []).map((p) => [p.id, p]));

      const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

      // Detalle de cada compra de paquete del rango: quién, qué día y cómo pagó.
      const purchases = (transactions ?? [])
        .filter((t) => new Date(t.created_at) >= monthStart)
        .map((t) => {
          const prof = t.user_id ? profileById.get(t.user_id) : undefined;
          return {
            date: t.created_at,
            client: prof?.full_name || prof?.email || "Cliente",
            email: prof?.email ?? "",
            plan: t.plan?.name ?? "Otro",
            category: t.plan?.category ?? "clases_pilates",
            method: PAYMENT_LABELS[t.payment_method] ?? t.payment_method,
            origin: (t.external_ref ?? "").startsWith("pinpad_")
              ? "Mostrador · terminal"
              : (t.external_ref ?? "").startsWith("pos_cash_")
                ? "Mostrador"
                : "En línea",
            amount: t.amount_cents,
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      let merchRevenue = 0;
      let consumibleRevenue = 0;
      const topMerch = new Map<string, { name: string; units: number; revenue: number }>();
      const topConsumibles = new Map<string, { name: string; units: number; revenue: number }>();
      const clientsMerch = new Map<string, { name: string; revenue: number }>();
      const clientsConsumibles = new Map<string, { name: string; revenue: number }>();
      const weeklyPos = weeks.map(() => 0);
      const weeklyTokens = weeks.map(() => 0);
      for (const item of saleItems ?? []) {
        const amount = item.qty * item.unit_price_cents;
        const product = item.product_id ? productById.get(item.product_id) : undefined;
        const cat = product?.category;
        const createdAt = item.sale?.created_at ? new Date(item.sale.created_at) : null;
        if (createdAt) {
          const wi = weeks.findIndex((w) => createdAt >= w.start && createdAt < w.end);
          if (wi >= 0) weeklyPos[wi]! += amount;
        }
        const clientId = item.sale?.user_id;
        const clientName = clientId
          ? profileById.get(clientId)?.full_name || profileById.get(clientId)?.email || "Cliente"
          : "Sin cliente";
        if (cat === "merch") {
          if (createdAt && createdAt >= monthStart) merchRevenue += amount;
          if (product) {
            const acc = topMerch.get(product.id) ?? { name: product.name, units: 0, revenue: 0 };
            acc.units += item.qty;
            acc.revenue += amount;
            topMerch.set(product.id, acc);
          }
          if (clientId) {
            const acc = clientsMerch.get(clientId) ?? { name: clientName, revenue: 0 };
            acc.revenue += amount;
            clientsMerch.set(clientId, acc);
          }
        } else if (cat === "consumible" || cat === "suplemento") {
          if (createdAt && createdAt >= monthStart) consumibleRevenue += amount;
          if (product) {
            const acc = topConsumibles.get(product.id) ?? {
              name: product.name,
              units: 0,
              revenue: 0,
            };
            acc.units += item.qty;
            acc.revenue += amount;
            topConsumibles.set(product.id, acc);
          }
          if (clientId) {
            const acc = clientsConsumibles.get(clientId) ?? { name: clientName, revenue: 0 };
            acc.revenue += amount;
            clientsConsumibles.set(clientId, acc);
          }
        }
      }
      for (const t of transactions ?? []) {
        const createdAt = new Date(t.created_at);
        const wi = weeks.findIndex((w) => createdAt >= w.start && createdAt < w.end);
        if (wi >= 0) weeklyTokens[wi]! += t.amount_cents;
      }
      const sortMap = (m: Map<string, { name: string; units: number; revenue: number }>) =>
        Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
      const sortClients = (m: Map<string, { name: string; revenue: number }>) =>
        Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);

      const { data: staff } = await supabase.from("staff_profiles").select("*").eq("active", true);
      const { data: hoursRows } = await supabase
        .from("payroll_period_hours")
        .select("*")
        .gte("period_start", monthStart.toISOString().slice(0, 10))
        .lte("period_end", toIso.slice(0, 10));
      const { data: adjustments } = await supabase
        .from("payroll_adjustments")
        .select("staff_id, amount_cents, created_at")
        .gte("created_at", trendFromIso)
        .lte("created_at", toIso);
      const payrollByStaff = new Map<string, { name: string; cost: number }>();
      let payrollCost = 0;
      const weeklyPayroll = weeks.map(() => 0);
      for (const s of staff ?? []) {
        const hours = (hoursRows ?? [])
          .filter((h) => h.staff_id === s.id)
          .reduce((sum, h) => sum + h.hours, 0);
        const monthAdjTotal = (adjustments ?? [])
          .filter((a) => a.staff_id === s.id && new Date(a.created_at) >= monthStart)
          .reduce((sum, a) => sum + a.amount_cents, 0);
        const cost = hours * s.hourly_rate_cents + monthAdjTotal;
        payrollCost += cost;
        payrollByStaff.set(s.id, { name: s.full_name, cost });
      }
      for (const a of adjustments ?? []) {
        const createdAt = new Date(a.created_at);
        const wi = weeks.findIndex((w) => createdAt >= w.start && createdAt < w.end);
        if (wi >= 0) weeklyPayroll[wi]! += a.amount_cents;
      }
      // La nómina real solo se sabe por periodo capturado, no por semana —
      // repartimos el costo del mes entre las semanas del rango como estimado
      // visual de tendencia, no como cifra contable exacta.
      const weeksInMonth = weeks.filter((w) => w.end > monthStart).length || 1;
      for (let i = 0; i < weeks.length; i++) {
        if (weeks[i]!.end > monthStart) weeklyPayroll[i]! += payrollCost / weeksInMonth;
      }

      const trend = weeks.map((w, i) => ({
        label: w.label,
        revenue: Math.round((weeklyPos[i]! + weeklyTokens[i]!) / 100),
        cost: Math.round(weeklyPayroll[i]! / 100),
        margin: Math.round((weeklyPos[i]! + weeklyTokens[i]! - weeklyPayroll[i]!) / 100),
        projected: false,
      }));
      const last4 = trend.slice(-4);
      const avgRevenue = last4.reduce((s, t) => s + t.revenue, 0) / (last4.length || 1);
      const avgCost = last4.reduce((s, t) => s + t.cost, 0) / (last4.length || 1);
      const lastActual = trend[trend.length - 1];
      const projected = [
        // primer punto proyectado = último real, para que la línea punteada
        // arranque pegada a la sólida en vez de dejar un salto en el aire
        {
          label: lastActual!.label,
          revenue: lastActual!.revenue,
          cost: lastActual!.cost,
          margin: lastActual!.margin,
          projected: true,
        },
        ...[1, 2].map((i) => ({
          label: `+${i} sem`,
          revenue: Math.round(avgRevenue),
          cost: Math.round(avgCost),
          margin: Math.round(avgRevenue - avgCost),
          projected: true,
        })),
      ];

      const totalRevenue = clasesRevenue + merchRevenue + consumibleRevenue;
      return {
        clasesRevenue,
        tokensByCategory,
        tokensByPlan: Array.from(tokensByPlan.values()).sort((a, b) => b.revenue - a.revenue),
        purchases,
        merchRevenue,
        consumibleRevenue,
        topMerch: sortMap(topMerch),
        topConsumibles: sortMap(topConsumibles),
        clientsMerch: sortClients(clientsMerch),
        clientsConsumibles: sortClients(clientsConsumibles),
        payrollCost,
        payrollByStaff: Array.from(payrollByStaff.values()).sort((a, b) => b.cost - a.cost),
        totalRevenue,
        margin: totalRevenue - payrollCost,
        trendActual: trend,
        trendProjected: projected,
      };
    },
  });

  const marginPositive = (data?.margin ?? 0) >= 0;
  const chartData = useMemo(() => {
    const actual = data?.trendActual ?? [];
    const projected = data?.trendProjected ?? [];
    const actualRows = actual.map((t) => ({
      label: t.label,
      Ingresos: t.revenue,
      Costo: t.cost,
      Margen: t.margin,
    }));
    // La proyección se guarda en columnas separadas para que recharts la
    // dibuje con línea punteada; el primer punto se repite (mismo valor que
    // el último real) solo para que la línea se vea continua, sin salto.
    const projectedRows = projected.map((t) => ({
      label: t.label,
      "Ingresos (proyección)": t.revenue,
      "Costo (proyección)": t.cost,
    }));
    return [...actualRows, ...projectedRows];
  }, [data]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs">
          <span className="eyebrow">Desde</span>
          <input
            type="date"
            value={rangeFromStr}
            onChange={(e) => setRangeFromStr(e.target.value)}
            className={input}
          />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Hasta</span>
          <input
            type="date"
            value={rangeToStr}
            onChange={(e) => setRangeToStr(e.target.value)}
            className={input}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setRangeFromStr(defaultFrom);
            setRangeToStr(defaultTo);
          }}
          className="border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted"
        >
          Este mes
        </button>
        <button
          type="button"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              const n = await downloadIncomeReport(monthStart, rangeEnd);
              toast.success(
                n > 0
                  ? `Reporte descargado (${n} movimientos).`
                  : "Reporte descargado (sin ventas en el periodo).",
              );
            } catch (e) {
              toast.error(describeError(e, "No se pudo generar el reporte."));
            } finally {
              setDownloading(false);
            }
          }}
          className="ml-auto inline-flex items-center gap-2 bg-foreground px-4 py-2.5 text-[0.65rem] uppercase tracking-[0.14em] text-background disabled:opacity-50"
        >
          <FileSpreadsheet className="h-4 w-4" />
          {downloading ? "Generando…" : "Descargar Excel"}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Del {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(monthStart)} al{" "}
        {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(rangeEnd)}. El gráfico de
        tendencia semanal siempre muestra las últimas 8 semanas, sin importar este filtro.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border border-border p-6">
          <p className="eyebrow">Ingresos del mes</p>
          <p className="mt-2 text-2xl">{money(data?.totalRevenue ?? 0)}</p>
        </div>
        <div className="border border-border p-6">
          <p className="eyebrow">Costo total (nómina)</p>
          <p className="mt-2 text-2xl">{money(data?.payrollCost ?? 0)}</p>
        </div>
        <div
          className={`border p-6 ${marginPositive ? "border-emerald-500" : "border-destructive"}`}
        >
          <p className="eyebrow">Margen real del negocio</p>
          <p
            className={`mt-2 text-2xl ${marginPositive ? "text-emerald-600" : "text-destructive"}`}
          >
            {marginPositive ? "+" : ""}
            {money(data?.margin ?? 0)}
          </p>
        </div>
      </div>

      <div className="border border-border p-6">
        <p className="mb-4 eyebrow">Tendencia semanal (MXN, últimas 8 semanas + proyección)</p>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              width={44}
            />
            <Tooltip
              formatter={(value: number) => money(value * 100)}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="Ingresos"
              stroke="#0F6E56"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="Costo"
              stroke="#D85A30"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="Margen"
              stroke="#185FA5"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="Ingresos (proyección)"
              stroke="#0F6E56"
              strokeWidth={2.5}
              strokeDasharray="6 5"
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="Costo (proyección)"
              stroke="#D85A30"
              strokeWidth={2}
              strokeDasharray="6 5"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setOpenCard("tokens")}
          className="border border-border p-5 text-left hover:border-foreground/40"
        >
          <p className="eyebrow">Tokens / créditos</p>
          <p className="mt-1 text-xl">{money(data?.clasesRevenue ?? 0)}</p>
        </button>
        <button
          type="button"
          onClick={() => setOpenCard("merch")}
          className="border border-border p-5 text-left hover:border-foreground/40"
        >
          <p className="eyebrow">Merch</p>
          <p className="mt-1 text-xl">{money(data?.merchRevenue ?? 0)}</p>
        </button>
        <button
          type="button"
          onClick={() => setOpenCard("consumibles")}
          className="border border-border p-5 text-left hover:border-foreground/40"
        >
          <p className="eyebrow">Consumibles</p>
          <p className="mt-1 text-xl">{money(data?.consumibleRevenue ?? 0)}</p>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setOpenCard("nomina")}
        className="block w-full border border-border p-5 text-left hover:border-foreground/40"
      >
        <p className="eyebrow">Nómina del mes</p>
        <p className="mt-1 text-xl">{money(data?.payrollCost ?? 0)}</p>
      </button>

      {openCard === "tokens" ? (
        <Popout onClose={() => setOpenCard(null)} wide>
          <p className="mb-4 eyebrow">Tokens / créditos — análisis</p>
          <div className="mb-5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTokenCategoryFilter("todas")}
              className={`border px-3 py-1 text-[0.6rem] uppercase ${tokenCategoryFilter === "todas" ? "border-foreground bg-foreground text-background" : "border-input"}`}
            >
              Todas
            </button>
            {Object.entries(TOKEN_CATEGORY_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTokenCategoryFilter(key)}
                className={`border px-3 py-1 text-[0.6rem] uppercase ${tokenCategoryFilter === key ? "border-foreground bg-foreground text-background" : "border-input"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(TOKEN_CATEGORY_LABELS).map(([key, label]) => (
              <div
                key={key}
                className={`border p-4 ${tokenCategoryFilter === key ? "border-foreground" : "border-border"}`}
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg">{money(data?.tokensByCategory.get(key) ?? 0)}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            Por paquete — clic en la columna para ordenar
          </p>
          <SortableTable
            rows={(data?.tokensByPlan ?? []).filter(
              (p) => tokenCategoryFilter === "todas" || p.category === tokenCategoryFilter,
            )}
            emptyLabel="Sin ventas de paquetes este mes."
            columns={[
              { key: "name", label: "Paquete" },
              {
                key: "category",
                label: "Categoría",
                format: (v) => TOKEN_CATEGORY_LABELS[v as string] ?? String(v),
              },
              { key: "count", label: "Ventas", align: "right" },
              {
                key: "revenue",
                label: "Ingreso",
                align: "right",
                format: (v) => money(v as number),
              },
            ]}
          />

          <p className="mb-2 mt-8 eyebrow">Quién compró y cuándo</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPlanFilter(null)}
              className={`border px-3 py-1 text-[0.6rem] uppercase ${planFilter === null ? "border-foreground bg-foreground text-background" : "border-input"}`}
            >
              Todos los paquetes
            </button>
            {(data?.tokensByPlan ?? [])
              .filter((p) => tokenCategoryFilter === "todas" || p.category === tokenCategoryFilter)
              .map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setPlanFilter(p.name)}
                  className={`border px-3 py-1 text-[0.6rem] uppercase ${planFilter === p.name ? "border-foreground bg-foreground text-background" : "border-input"}`}
                >
                  {p.name} ({p.count})
                </button>
              ))}
          </div>
          <SortableTable
            rows={(data?.purchases ?? []).filter(
              (p) =>
                (tokenCategoryFilter === "todas" || p.category === tokenCategoryFilter) &&
                (planFilter === null || p.plan === planFilter),
            )}
            emptyLabel="Sin compras de este paquete en el periodo."
            columns={[
              {
                key: "date",
                label: "Fecha",
                format: (v) =>
                  new Intl.DateTimeFormat("es-MX", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(v as string)),
              },
              { key: "client", label: "Cliente" },
              { key: "email", label: "Correo" },
              { key: "plan", label: "Paquete" },
              { key: "method", label: "Pago" },
              { key: "origin", label: "Dónde" },
              {
                key: "amount",
                label: "Monto",
                align: "right",
                format: (v) => money(v as number),
              },
            ]}
          />
        </Popout>
      ) : null}

      {openCard === "merch" ? (
        <Popout onClose={() => setOpenCard(null)} wide>
          <p className="mb-4 eyebrow">Merch — análisis</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Productos — clic en la columna para ordenar
          </p>
          <SortableTable
            rows={data?.topMerch ?? []}
            emptyLabel="Sin ventas de merch este mes."
            columns={[
              { key: "name", label: "Producto" },
              { key: "units", label: "Unidades", align: "right" },
              {
                key: "revenue",
                label: "Ingreso",
                align: "right",
                format: (v) => money(v as number),
              },
            ]}
          />
          <p className="mb-2 mt-6 text-xs text-muted-foreground">
            Clientes — clic en la columna para ordenar
          </p>
          <SortableTable
            rows={data?.clientsMerch ?? []}
            emptyLabel="Sin datos todavía."
            columns={[
              { key: "name", label: "Cliente" },
              {
                key: "revenue",
                label: "Gastado",
                align: "right",
                format: (v) => money(v as number),
              },
            ]}
          />
        </Popout>
      ) : null}

      {openCard === "consumibles" ? (
        <Popout onClose={() => setOpenCard(null)} wide>
          <p className="mb-4 eyebrow">Consumibles — análisis</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Productos — clic en la columna para ordenar
          </p>
          <SortableTable
            rows={data?.topConsumibles ?? []}
            emptyLabel="Sin ventas de consumibles este mes."
            columns={[
              { key: "name", label: "Producto" },
              { key: "units", label: "Unidades", align: "right" },
              {
                key: "revenue",
                label: "Ingreso",
                align: "right",
                format: (v) => money(v as number),
              },
            ]}
          />
          <p className="mb-2 mt-6 text-xs text-muted-foreground">
            Clientes — clic en la columna para ordenar
          </p>
          <SortableTable
            rows={data?.clientsConsumibles ?? []}
            emptyLabel="Sin datos todavía."
            columns={[
              { key: "name", label: "Cliente" },
              {
                key: "revenue",
                label: "Gastado",
                align: "right",
                format: (v) => money(v as number),
              },
            ]}
          />
        </Popout>
      ) : null}

      {openCard === "nomina" ? (
        <Popout onClose={() => setOpenCard(null)}>
          <p className="mb-4 eyebrow">Nómina del mes — desglose</p>
          <SortableTable
            rows={data?.payrollByStaff ?? []}
            emptyLabel="Sin staff activo."
            columns={[
              { key: "name", label: "Persona" },
              { key: "cost", label: "Costo", align: "right", format: (v) => money(v as number) },
            ]}
          />
        </Popout>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Nota: el margen resta solo el costo de nómina (horas capturadas por Excel × tarifa +
        ajustes) a los ingresos totales del mes. La línea punteada de la gráfica es una proyección
        simple (promedio de las últimas 4 semanas), no un pronóstico financiero preciso.
      </p>
    </div>
  );
}

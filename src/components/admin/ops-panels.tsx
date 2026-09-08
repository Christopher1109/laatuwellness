import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ShoppingCart, Users, ClipboardCheck } from "lucide-react";
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
import { tryChargePendingNoShowFee } from "@/utils/membership-fee";
import { SignaturePad } from "@/components/signature-pad";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={`max-h-[85vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto bg-background p-6`}
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
// PEDIDOS PENDIENTES (Fuel / tienda) — pedidos que los clientes
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
  const [filter, setFilter] = useState<"activos" | "todos">("activos");
  const [signingOrder, setSigningOrder] = useState<{ id: string; clientName: string } | null>(
    null,
  );
  const [signature, setSignature] = useState<string | null>(null);

  const { data: orders } = useQuery({
    queryKey: ["pending-orders"],
    queryFn: async () => {
      const { data: sales, error } = await supabase
        .from("pos_sales")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      const saleIds = (sales ?? []).map((s) => s.id);
      const { data: items } = saleIds.length
        ? await supabase.from("pos_sale_items").select("*").in("sale_id", saleIds)
        : { data: [] as { sale_id: string; description: string; qty: number }[] };
      const userIds = Array.from(
        new Set((sales ?? []).map((s) => s.user_id).filter(Boolean)),
      ) as string[];
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [] as { id: string; full_name: string; email: string }[] };
      return (sales ?? []).map((s) => ({
        ...s,
        items: (items ?? []).filter((i) => i.sale_id === s.id),
        client: profiles?.find((p) => p.id === s.user_id),
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
      const { error } = await supabase.from("pos_sales").update({ status: "entregado" }).eq("id", id);
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

  const visible = (orders ?? []).filter((o) =>
    filter === "activos" ? o.status !== "entregado" : true,
  );

  return (
    <div>
      <div className="mb-4 flex gap-1.5">
        {(["activos", "todos"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] ${filter === f ? "border-foreground bg-foreground text-background" : "border-input"}`}
          >
            {f === "activos" ? "Activos" : "Todos"}
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
                  <p className="truncate text-sm font-medium">{clientName}</p>
                  {(o as unknown as { order_code?: string }).order_code ? (
                    <p className="font-mono text-[0.65rem] text-muted-foreground">
                      {(o as unknown as { order_code?: string }).order_code}
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
                  <li key={idx}>
                    {i.qty}× {i.description}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">{money(o.total_cents)}</p>
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
          <p className="col-span-full text-muted-foreground">Sin pedidos en este filtro.</p>
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
          <div
            className="w-full max-w-md bg-background p-6"
            onClick={(e) => e.stopPropagation()}
          >
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products ?? [];
    return (products ?? []).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [products, search]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [clientEmail, setClientEmail] = useState("");
  const [matchedClient, setMatchedClient] = useState<{
    id: string;
    full_name: string;
    email: string;
  } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [payment, setPayment] = useState("efectivo");

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

  const total = useMemo(() => {
    if (!products) return 0;
    return Object.entries(cart).reduce((sum, [id, qty]) => {
      const p = products.find((p) => p.id === id);
      return sum + (p ? p.price_cents * qty : 0);
    }, 0);
  }, [cart, products]);

  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const checkout = useMutation({
    mutationFn: async () => {
      if (!matchedClient) throw new Error("Busca al cliente por correo antes de cobrar.");
      const items = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => {
          const p = products?.find((p) => p.id === id);
          return {
            product_id: id,
            description: p?.name ?? "",
            qty,
            unit_price_cents: p?.price_cents ?? 0,
          };
        });
      if (items.length === 0) throw new Error("Agrega al menos un producto");
      const { error } = await supabase.rpc("pos_checkout", {
        _user_id: matchedClient.id,
        _payment_method: payment,
        _items: items,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venta registrada.");
      setCart({});
      setClientEmail("");
      setMatchedClient(null);
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo cobrar."),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU o categoría…"
            className={`${input} pl-9`}
            autoFocus
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => {
            const qty = cart[p.id] ?? 0;
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-3 border p-4 transition-colors ${qty > 0 ? "border-foreground" : "border-border"}`}
              >
                <div className="min-w-0">
                  <p className="truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {money(p.price_cents)} · stock {p.stock} {p.unit}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="border border-input px-2.5 py-1"
                    onClick={() =>
                      setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))
                    }
                  >
                    −
                  </button>
                  <span className="w-6 text-center">{qty}</span>
                  <button
                    className="border border-input px-2.5 py-1"
                    onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin resultados.</p>
          ) : null}
        </div>
      </div>

      <div className="h-fit space-y-4 border border-border p-6">
        <p className="eyebrow">
          Cobro {itemCount > 0 ? `· ${itemCount} artículo${itemCount === 1 ? "" : "s"}` : ""}
        </p>
        <label className="relative block text-xs">
          <span className="eyebrow">Correo o nombre del cliente (obligatorio)</span>
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
            className={input}
            placeholder="cliente@correo.com"
            autoComplete="off"
            required
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
            </span>
          ) : null}
        </label>
        <label className="block text-xs">
          <span className="eyebrow">Método de pago</span>
          <select value={payment} onChange={(e) => setPayment(e.target.value)} className={input}>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="transferencia">Transferencia</option>
          </select>
        </label>
        <p className="text-2xl">{money(total)}</p>
        <button
          disabled={checkout.isPending || itemCount === 0 || !matchedClient}
          onClick={() => checkout.mutate()}
          className="w-full bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
        >
          Cobrar
        </button>
      </div>
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-products"] }),
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
        <summary className="cursor-pointer eyebrow">Agregar producto</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              name: String(f.get("name") || ""),
              category: String(f.get("category") || "merch"),
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
            <span className="eyebrow">Categoría</span>
            <input name="category" defaultValue="merch" className={input} list="inv-categories" />
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
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Categoría</th>
              <th className="px-4 py-3">Precio / costo</th>
              <th className="px-4 py-3">Margen</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Caducidad</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((p) => {
              const low = p.stock <= p.low_stock_threshold;
              const expiring = p.expires_at ? new Date(p.expires_at) <= soon : false;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <p>{p.name}</p>
                    {p.unit_size ? (
                      <p className="text-xs text-muted-foreground">{p.unit_size}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.category}</td>
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
                    {p.stock} {p.unit}
                    {low ? " · bajo" : ""}
                  </td>
                  <td
                    className={`px-4 py-3 ${expiring ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {p.expires_at
                      ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                          new Date(p.expires_at),
                        )
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="border border-input px-2.5 py-1"
                        onClick={() =>
                          adjust.mutate({ id: p.id, delta: -1, reason: "Salida manual" })
                        }
                      >
                        −
                      </button>
                      <button
                        className="border border-input px-2.5 py-1"
                        onClick={() =>
                          adjust.mutate({ id: p.id, delta: 1, reason: "Entrada manual" })
                        }
                      >
                        +
                      </button>
                      <button
                        className="border border-input px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.12em]"
                        onClick={() => update.mutate({ id: p.id, patch: { active: !p.active } })}
                      >
                        {p.active ? "Ocultar" : "Publicar"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
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
    </div>
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
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="min-w-[280px] text-xs">
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
        <div className="relative min-w-[220px] flex-1">
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
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p>{r.profile?.full_name || "Sin nombre"}</p>
              <p className="text-muted-foreground">{r.profile?.email}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStatus.mutate({ bookingId: r.id, status: "a_tiempo" })}
                className={`border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] ${r.checkin?.status === "a_tiempo" ? "border-foreground bg-foreground text-background" : "border-input"}`}
              >
                A tiempo
              </button>
              <button
                onClick={() => setStatus.mutate({ bookingId: r.id, status: "tarde" })}
                className={`border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] ${r.checkin?.status === "tarde" ? "border-foreground bg-foreground text-background" : "border-input"}`}
              >
                Tarde
              </button>
              <button
                onClick={() => setStatus.mutate({ bookingId: r.id, status: "no_show" })}
                className={`border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em] text-destructive ${r.checkin?.status === "no_show" ? "border-destructive bg-destructive text-background" : "border-input"}`}
              >
                No-show
              </button>
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
// STAFF: directorio + tarifas + alta de perfiles
// ============================================================================
export function StaffDirectoryPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*")
        .neq("role", "coach")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (payload: {
      full_name: string;
      email: string;
      role: "admin" | "staff" | "coach";
      hourly_rate_cents: number;
    }) => {
      const { error } = await supabase.from("staff_profiles").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        "Perfil creado. La persona quedará vinculada al iniciar sesión con ese correo.",
      );
      void qc.invalidateQueries({ queryKey: ["admin-staff"] });
    },
    onError: () => toast.error("No se pudo crear (¿correo repetido?)."),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"staff_profiles"> }) => {
      const { error } = await supabase.from("staff_profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-staff"] }),
  });

  return (
    <div>
      <p className="mb-4 text-xs text-muted-foreground">
        Aquí ves staff y administración. Los coaches viven en su propio módulo (Coaches), donde ves
        sus clases y reservaciones.
      </p>
      <details className="mb-6 border border-border p-6">
        <summary className="cursor-pointer eyebrow">Dar de alta a alguien del equipo</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              full_name: String(f.get("full_name") || ""),
              email: String(f.get("email") || ""),
              role: String(f.get("role") || "staff") as "admin" | "staff" | "coach",
              hourly_rate_cents: Math.round(Number(f.get("rate") || 0) * 100),
            });
            e.currentTarget.reset();
          }}
        >
          <label className="text-xs">
            <span className="eyebrow">Nombre</span>
            <input name="full_name" required className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Correo administrativo</span>
            <input name="email" type="email" required className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Rol</span>
            <select name="role" defaultValue="staff" className={input}>
              <option value="staff">Staff / recepción</option>
              <option value="coach">Coach</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Tarifa por hora (MXN)</span>
            <input name="rate" type="number" min={0} step="0.01" className={input} />
          </label>
          <div className="flex items-end">
            <button className="w-full bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
              Dar de alta
            </button>
          </div>
        </form>
      </details>

      <ul className="divide-y divide-border border-y border-border text-sm">
        {(data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <input
                defaultValue={s.full_name}
                onBlur={(e) => update.mutate({ id: s.id, patch: { full_name: e.target.value } })}
                className="border-b border-transparent bg-transparent hover:border-input focus:border-foreground focus:outline-none"
              />
              <p className="text-muted-foreground">
                <input
                  defaultValue={s.email}
                  onBlur={(e) => update.mutate({ id: s.id, patch: { email: e.target.value } })}
                  className="border-b border-transparent bg-transparent text-xs hover:border-input focus:border-foreground focus:outline-none"
                />
                {s.user_id ? "" : " · aún no ha iniciado sesión"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <select
                value={s.role}
                onChange={(e) =>
                  update.mutate({
                    id: s.id,
                    patch: { role: e.target.value as "admin" | "staff" | "coach" },
                  })
                }
                className={`${input} w-auto`}
              >
                <option value="staff">Staff</option>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
              <label className="text-xs">
                <span className="eyebrow">Tarifa/hr</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={s.hourly_rate_cents / 100}
                  onBlur={(e) =>
                    update.mutate({
                      id: s.id,
                      patch: { hourly_rate_cents: Math.round(Number(e.target.value) * 100) },
                    })
                  }
                  className={input}
                />
              </label>
              <button
                onClick={() => update.mutate({ id: s.id, patch: { active: !s.active } })}
                className={`h-fit border px-4 py-2 text-[0.7rem] uppercase tracking-[0.16em] ${s.active ? "border-foreground bg-foreground text-background" : "border-input"}`}
              >
                {s.active ? "Activo" : "Inactivo"}
              </button>
            </div>
          </li>
        ))}
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

export function StaffHomePanel({
  onGoTo,
}: {
  onGoTo: (key: string, moduleKey?: string) => void;
}) {

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-6 sm:grid-cols-3">
      {STAFF_HOME_BUTTONS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onGoTo(key)}
          className="flex flex-col items-center justify-center gap-4 border border-border bg-background p-10 text-center transition-colors hover:border-foreground hover:bg-muted"
        >
          <Icon className="h-10 w-10" />
          <span className="text-lg">{label}</span>
        </button>
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

export function DashboardPanel({
  onGoTo,
}: {
  onGoTo: (key: string, moduleKey?: string) => void;
}) {

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
      const { data: transactions } = await supabase
        .from("transactions")
        .select("user_id, amount_cents, status");
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
      for (const t of transactions ?? []) {
        if (t.status === "completed")
          revenue.set(t.user_id, (revenue.get(t.user_id) ?? 0) + t.amount_cents);
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
  const filtered = (data ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

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

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente por nombre o correo…"
          className={`${input} pl-9`}
        />
      </div>

      <ul className="divide-y divide-border border-y border-border text-sm">
        {filtered.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <button
              type="button"
              onClick={() => setOpenClientId(c.id)}
              className="min-w-0 flex-1 text-left hover:opacity-70"
            >
              <p>{c.full_name || "Sin nombre"}</p>
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

const PAYMENT_METHODS = [
  { key: "saldo", label: "Saldo de cuenta" },
  { key: "transferencia", label: "Transferencia" },
  { key: "tarjeta", label: "Tarjeta" },
  { key: "efectivo", label: "Efectivo" },
  { key: "cortesia", label: "Cortesía" },
];

type ClientTab = "reservaciones" | "compras" | "creditos" | "notas";
const CLIENT_TABS: { key: ClientTab; label: string }[] = [
  { key: "reservaciones", label: "Reservaciones" },
  { key: "compras", label: "Compras" },
  { key: "creditos", label: "Créditos" },
  { key: "notas", label: "Notas" },
];

function ClientDetailDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ClientTab>("reservaciones");
  const [showPackages, setShowPackages] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<Tables<"token_plans"> | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

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

  const { data: reservations } = useQuery({
    queryKey: ["client-detail-bookings", clientId],
    queryFn: async () => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false })
        .limit(60);
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

  const buyPlan = useMutation({
    mutationFn: async ({ planId, paymentMethod }: { planId: string; paymentMethod: string }) => {
      const { error } = await supabase.rpc("admin_purchase_plan", {
        _user_id: clientId,
        _plan_id: planId,
        _payment_method: paymentMethod,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venta registrada — créditos agregados al cliente.");
      setShowPackages(false);
      setPendingPlan(null);
      void qc.invalidateQueries({ queryKey: ["client-detail-balance", clientId] });
      void qc.invalidateQueries({ queryKey: ["client-detail-purchases", clientId] });
    },
    onError: () => toast.error("No se pudo registrar la compra."),
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
      void qc.invalidateQueries({ queryKey: ["client-detail-profile", clientId] });
    },
    onError: () => toast.error("No se pudieron guardar las notas."),
  });

  const initials = (profile?.full_name || profile?.email || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div>
      <div>

        <button
          onClick={onClose}
          className="mb-6 text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          ← Volver a clientes
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-muted text-lg text-muted-foreground">
              {initials}
            </div>
            <div>
              <p className="text-lg font-medium">{profile?.full_name || "Sin nombre"}</p>
              <p className="text-sm text-muted-foreground">
                {profile?.email}
                {profile?.phone ? ` · ${profile.phone}` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setTab("compras")}
              className="border border-input px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-muted"
            >
              Ver compras
            </button>
            <button
              onClick={() => setTab("creditos")}
              className="bg-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-background"
            >
              Comprar créditos
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-6 border-b border-border">
          {CLIENT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "border-b-2 pb-3 text-[0.72rem] uppercase tracking-[0.12em]",
                tab === t.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="py-8">
          {tab === "reservaciones" ? (
            <div>
              <p className="mb-4 eyebrow">Historial de reservaciones</p>
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
                      <span className={cn("shrink-0 px-2 py-1 text-[0.62rem]", TONE_CLASSES[tone])}>
                        {label}
                      </span>
                    </div>
                  );
                })}
                {(reservations ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin reservaciones todavía.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "compras" ? (
            <div>
              <p className="mb-4 eyebrow">Historial de compras</p>
              <div className="space-y-1.5">
                {(purchases ?? []).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 border border-border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{t.plan?.name ?? "Compra"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                          new Date(t.created_at),
                        )}{" "}
                        · {t.payment_method}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {money(t.amount_cents)}
                      <br />+{t.tokens} créditos
                    </span>
                  </div>
                ))}
                {(purchases ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin compras registradas.</p>
                ) : null}
              </div>
            </div>
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
                  Comprar paquete
                </button>
              </div>

              {showPackages ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {(plans ?? []).map((p) => (
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

      {pendingPlan ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-end bg-black/40"
          onClick={() => setPendingPlan(null)}
        >
          <div
            className="h-full w-full max-w-sm overflow-y-auto bg-background p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="eyebrow">Pago</p>
            <div className="mt-3 flex items-center justify-between border-b border-border pb-3 text-sm">
              <span>{pendingPlan.name}</span>
              <span>{money(pendingPlan.price_cents)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-lg">
              <span>Total</span>
              <span>{money(pendingPlan.price_cents)}</span>
            </div>

            <div className="mt-6 space-y-2.5">
              {PAYMENT_METHODS.map((m) => (
                <label key={m.key} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="payment-method"
                    checked={paymentMethod === m.key}
                    onChange={() => setPaymentMethod(m.key)}
                  />
                  {m.label}
                </label>
              ))}
            </div>

            {pendingPlan.terms ? (
              <p className="mt-6 text-xs text-muted-foreground">{pendingPlan.terms}</p>
            ) : null}

            <div className="mt-8 flex gap-2">
              <button
                onClick={() => setPendingPlan(null)}
                className="flex-1 border border-input px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em]"
              >
                Cancelar
              </button>
              <button
                disabled={buyPlan.isPending}
                onClick={() => buyPlan.mutate({ planId: pendingPlan.id, paymentMethod })}
                className="flex-1 bg-emerald-600 px-4 py-3 text-[0.68rem] uppercase tracking-[0.16em] text-white disabled:opacity-50"
              >
                {buyPlan.isPending ? "Procesando…" : "Pagar"}
              </button>
            </div>
          </div>
        </div>
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
        const { error } = await (supabase.from("products").update as any)(payload).eq(
          "id",
          row.id,
        );
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
              onSave={(row) =>
                save.mutate(editingId ? { ...row, id: editingId } : row)
              }
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
}: {
  product: (Tables<"products"> & { description?: string }) | null;
  onCancel: () => void;
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
      className="col-span-full border border-border p-5"
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
      <div className="grid gap-4 sm:grid-cols-2">
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
            <span className="eyebrow">Publicado en /merch</span>
          </label>
        </div>
      </div>

      <label className="mt-4 block text-xs">
        <span className="eyebrow">Descripción (se ve en la tienda pública)</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={product?.description ?? ""}
          className={`${input} resize-none`}
        />
      </label>

      <div className="mt-4 flex gap-3">
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
      <td colSpan={6} className="px-4 py-4">
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
                  {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(r.created_at),
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
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
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Cupón de referido</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Código general reutilizable: cualquier clienta que lo use recibe 1 clase gratis. Edita el
          código y el límite de usos aquí — no necesitas pedirme que cambie código.
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
              <th className="px-4 py-3">Límite de usos</th>
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
            tokens: Number(f.get("tokens") || 1),
            recurring: f.get("recurring") === "on",
            validity_days: f.get("validity_days") ? Number(f.get("validity_days")) : null,
            includes: String(f.get("includes") || ""),
            terms: String(f.get("terms") || ""),
            active: plan ? plan.active : true,
            sort_order: plan?.sort_order ?? 0,
          });
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
        const base = classesForCoach.reduce(
          (sum, c) => sum + tierRateFor(s.id, c.attendance),
          0,
        );
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
// PERFIL DE COACH
// ============================================================================
// ============================================================================
// COACHES — vista admin: elige un coach y ve sus clases de hoy/semana/mes y
// cuántas reservaciones ha tenido.
// ============================================================================
export function CoachesPanel() {
  const { data: coaches } = useQuery({
    queryKey: ["admin-coaches-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*")
        .eq("role", "coach")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      {(coaches ?? []).length === 0 ? (
        <p className="text-muted-foreground">
          Sin coaches dados de alta todavía (asigna el rol "Coach" en Staff).
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(coaches ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className="border border-border p-4 text-left hover:border-foreground/40"
            >
              <div className="mb-2 flex items-center gap-2">
                <Avatar className="h-9 w-9">
                  {c.photo_url ? <AvatarImage src={c.photo_url} alt="" /> : null}
                  <AvatarFallback className="text-xs">
                    {c.full_name
                      .split(" ")
                      .slice(0, 2)
                      .map((p) => p[0]?.toUpperCase())
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.full_name}</p>
                  <p className="text-xs text-muted-foreground">{money(c.hourly_rate_cents)}/h</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {openId ? <CoachDetailPopout coachId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function CoachDetailPopout({ coachId, onClose }: { coachId: string; onClose: () => void }) {
  const [range, setRange] = useState<"hoy" | "semana" | "mes">("hoy");

  const { data: coach } = useQuery({
    queryKey: ["coach-detail-profile", coachId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*")
        .eq("id", coachId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const bounds = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (range === "hoy") end.setDate(end.getDate() + 1);
    else if (range === "semana") end.setDate(end.getDate() + 7);
    else end.setMonth(end.getMonth() + 1);
    return { start, end };
  }, [range]);

  const { data: classes } = useQuery({
    queryKey: [
      "coach-detail-classes",
      coachId,
      bounds.start.toISOString(),
      bounds.end.toISOString(),
    ],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("coach_id", coachId)
        .gte("starts_at", bounds.start.toISOString())
        .lt("starts_at", bounds.end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: bookingsByClass } = useQuery({
    queryKey: ["coach-detail-bookings", (classes ?? []).map((c) => c.id).join(",")],
    enabled: Boolean(classes?.length),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .in(
          "class_id",
          (classes ?? []).map((c) => c.id),
        );
      if (error) throw error;
      const map = new Map<string, { reservada: number; cancelada: number; lista_espera: number }>();
      for (const b of data ?? []) {
        const acc = map.get(b.class_id) ?? { reservada: 0, cancelada: 0, lista_espera: 0 };
        if (b.status === "reservada") acc.reservada += 1;
        if (b.status === "cancelada") acc.cancelada += 1;
        if (b.status === "lista_espera") acc.lista_espera += 1;
        map.set(b.class_id, acc);
      }
      return map;
    },
  });

  const totals = (classes ?? []).reduce(
    (acc, c) => {
      const b = bookingsByClass?.get(c.id) ?? { reservada: 0, cancelada: 0, lista_espera: 0 };
      acc.reservada += b.reservada;
      acc.cancelada += b.cancelada;
      acc.espera += b.lista_espera;
      return acc;
    },
    { reservada: 0, cancelada: 0, espera: 0 },
  );

  return (
    <Popout onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-lg font-medium">{coach?.full_name}</p>
          <p className="text-xs text-muted-foreground">{money(coach?.hourly_rate_cents ?? 0)}/h</p>
        </div>
        <div className="flex gap-1.5">
          {(["hoy", "semana", "mes"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] ${range === r ? "border-foreground bg-foreground text-background" : "border-input"}`}
            >
              {r === "hoy" ? "Hoy" : r === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Clases</p>
          <p className="mt-1 text-lg">{(classes ?? []).length}</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Reservaciones</p>
          <p className="mt-1 text-lg">{totals.reservada}</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Cancelaciones</p>
          <p className="mt-1 text-lg">{totals.cancelada}</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Lista de espera</p>
          <p className="mt-1 text-lg">{totals.espera}</p>
        </div>
      </div>

      <ul className="divide-y divide-border border-y border-border text-sm">
        {(classes ?? []).map((c) => {
          const b = bookingsByClass?.get(c.id) ?? { reservada: 0, cancelada: 0, lista_espera: 0 };
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {new Intl.DateTimeFormat("es-MX", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(c.starts_at))}
              </span>
              <span className="text-muted-foreground">
                {c.room} · {c.module_key}
              </span>
              <span className="flex gap-1.5">
                <span
                  className={
                    b.reservada >= c.capacity
                      ? "bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                      : "bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {b.reservada}/{c.capacity}
                </span>
                {b.cancelada > 0 ? (
                  <span className="bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
                    {b.cancelada} canceló
                  </span>
                ) : null}
                {b.lista_espera > 0 ? (
                  <span className="bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
                    {b.lista_espera} en espera
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        {(classes ?? []).length === 0 ? (
          <li className="py-6 text-muted-foreground">Sin clases en este rango.</li>
        ) : null}
      </ul>

      <div className="mt-8 border-t border-border pt-6">
        <CoachRateTiersEditor coachId={coachId} />
      </div>
    </Popout>
  );
}

function CoachRateTiersEditor({ coachId }: { coachId: string }) {
  const qc = useQueryClient();
  const [minAttendance, setMinAttendance] = useState("");
  const [rate, setRate] = useState("");

  const { data: tiers } = useQuery({
    queryKey: ["coach-rate-tiers", coachId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { data, error } = await (supabase.from as any)("coach_rate_tiers")
        .select("*")
        .eq("coach_id", coachId)
        .order("min_attendance");
      if (error) throw error;
      return data as { id: string; min_attendance: number; rate_cents: number }[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { error } = await (supabase.from as any)("coach_rate_tiers").insert({
        coach_id: coachId,
        min_attendance: Number(minAttendance),
        rate_cents: Math.round(Number(rate) * 100),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rango agregado.");
      setMinAttendance("");
      setRate("");
      void qc.invalidateQueries({ queryKey: ["coach-rate-tiers", coachId] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { error } = await (supabase.from as any)("coach_rate_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["coach-rate-tiers", coachId] }),
  });

  return (
    <div>
      <p className="eyebrow">Pago por ocupación del salón</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Precio fijo por clase según cuántas personas asistieron. Se aplica el rango más alto que
        no se pase de la asistencia real. Si no configuras nada aquí, este coach sigue cobrando
        por hora como de costumbre.
      </p>

      <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
        {(tiers ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 py-2.5">
            <span>Desde {t.min_attendance} {t.min_attendance === 1 ? "persona" : "personas"}</span>
            <span className="flex items-center gap-3">
              <span className="font-mono">{money(t.rate_cents)} / clase</span>
              <button
                type="button"
                onClick={() => remove.mutate(t.id)}
                className="text-xs uppercase tracking-wide text-muted-foreground hover:text-destructive"
              >
                Quitar
              </button>
            </span>
          </li>
        ))}
        {(tiers ?? []).length === 0 ? (
          <li className="py-3 text-muted-foreground">Sin rangos configurados.</li>
        ) : null}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="eyebrow">Desde (personas)</span>
          <input
            type="number"
            min="0"
            value={minAttendance}
            onChange={(e) => setMinAttendance(e.target.value)}
            className={`${input} w-32`}
          />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Precio por clase (MXN)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={`${input} w-32`}
          />
        </label>
        <button
          type="button"
          onClick={() => add.mutate()}
          disabled={!minAttendance || !rate || add.isPending}
          className="border border-input px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] hover:bg-muted disabled:opacity-50"
        >
          + Agregar rango
        </button>
      </div>
    </div>
  );
}

export function CoachProfilePanel() {
  const { staffProfile } = useAuth();

  const { data: classes } = useQuery({
    queryKey: ["coach-classes", staffProfile?.id],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("coach_id", staffProfile!.id)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const { data: bookingCounts } = useQuery({
    queryKey: ["coach-bookings", classes?.map((c) => c.id).join(",")],
    enabled: Boolean(classes?.length),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .in(
          "class_id",
          (classes ?? []).map((c) => c.id),
        )
        .eq("status", "reservada");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const b of data ?? []) counts.set(b.class_id, (counts.get(b.class_id) ?? 0) + 1);
      return counts;
    },
  });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { data: monthSeconds } = useQuery({
    queryKey: ["coach-month-seconds", staffProfile?.id],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_worked_seconds", {
        _staff_id: staffProfile!.id,
        _from: monthStart.toISOString(),
        _to: new Date().toISOString(),
      });
      if (error) throw error;
      return data ?? 0;
    },
  });

  const monthEarnings = ((monthSeconds ?? 0) / 3600) * (staffProfile?.hourly_rate_cents ?? 0);

  return (
    <div className="space-y-10">
      <div className="border border-border p-6">
        <p className="eyebrow">Lo que llevo del mes</p>
        <p className="mt-2 text-2xl">{money(monthEarnings)}</p>
        <p className="text-muted-foreground">
          {((monthSeconds ?? 0) / 3600).toFixed(1)} horas registradas en el checador
        </p>
      </div>

      <div>
        <p className="eyebrow">Próximas clases</p>
        <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
          {(classes ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <span>
                {new Intl.DateTimeFormat("es-MX", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(c.starts_at))}
              </span>
              <span>{c.room}</span>
              <span className="text-muted-foreground">
                Cupo {bookingCounts?.get(c.id) ?? 0}/{c.capacity}
              </span>
            </li>
          ))}
          {(classes ?? []).length === 0 ? (
            <li className="py-6 text-muted-foreground">Sin clases próximas asignadas.</li>
          ) : null}
        </ul>
      </div>
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
    queryKey: ["finance-month", monthStart.toISOString(), rangeEnd.toISOString(), weeks[0]?.start.toISOString()],
    queryFn: async () => {
      const fromIso = monthStart.toISOString();
      const toIso = rangeEnd.toISOString();
      const trendFromIso = weeks[0]!.start.toISOString();
      // El fetch tiene que cubrir lo que sea más amplio: las 8 semanas del
      // trend, o el rango de fechas que eligió el usuario.
      const fetchFromIso =
        new Date(fromIso) < new Date(trendFromIso) ? fromIso : trendFromIso;

      const { data: transactions } = await supabase
        .from("transactions")
        .select("amount_cents, status, created_at, user_id, plan:token_plans(category, name)")
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
        .select("qty, unit_price_cents, product_id, sale:pos_sales!inner(created_at, user_id)")
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
      </div>
      <p className="text-sm text-muted-foreground">
        Del {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(monthStart)} al{" "}
        {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(rangeEnd)}. El gráfico
        de tendencia semanal siempre muestra las últimas 8 semanas, sin importar este filtro.
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
          <p className="eyebrow">Consumibles (Fuel)</p>
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
          <p className="mb-4 eyebrow">Consumibles (Fuel) — análisis</p>
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

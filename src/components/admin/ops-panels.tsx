import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

export const input =
  "w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format((cents ?? 0) / 100);

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const UNITS = ["pieza", "caja", "kg", "g", "l", "ml", "dosis"];

// ============================================================================
// PUNTO DE VENTA (POS)
// ============================================================================
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
  const [payment, setPayment] = useState("efectivo");

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
      let userId: string | null = null;
      if (clientEmail.trim()) {
        const { data } = await supabase
          .from("profiles")
          .select("id")
          .ilike("email", clientEmail.trim())
          .maybeSingle();
        userId = data?.id ?? null;
      }
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
        _user_id: userId as string,
        _payment_method: payment,
        _items: items,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venta registrada.");
      setCart({});
      setClientEmail("");
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
        <label className="block text-xs">
          <span className="eyebrow">Correo del cliente (opcional)</span>
          <input
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            className={input}
            placeholder="cliente@correo.com"
          />
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
          disabled={checkout.isPending || itemCount === 0}
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
            <span className="eyebrow">Precio (MXN)</span>
            <input name="price" type="number" min={0} step="0.01" className={input} />
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
              <th className="px-4 py-3">Precio</th>
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
                  <td className="px-4 py-3">{money(p.price_cents)}</td>
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
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
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
        const { error } = await supabase.rpc("mark_no_show", {
          _booking_id: bookingId,
          _penalty_cents: 0,
        });
        if (error) throw error;
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
      const { data, error } = await supabase.from("staff_profiles").select("*").order("full_name");
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

      return (profiles ?? []).map((p) => ({
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
            <div>
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
            </div>
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

  const { data: rows } = useQuery({
    queryKey: ["payroll-calc", from, to, staff?.map((s) => s.id).join(",")],
    enabled: Boolean(staff?.length),
    queryFn: async () => {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const results = [];
      for (const s of staff ?? []) {
        const { data: seconds } = await supabase.rpc("staff_worked_seconds", {
          _staff_id: s.id,
          _from: fromIso,
          _to: toIso,
        });
        const { data: adjustments } = await supabase
          .from("payroll_adjustments")
          .select("*")
          .eq("staff_id", s.id)
          .gte("created_at", fromIso)
          .lt("created_at", toIso);
        const hours = (seconds ?? 0) / 3600;
        const base = Math.round(hours * s.hourly_rate_cents);
        const adjTotal = (adjustments ?? []).reduce((sum, a) => sum + a.amount_cents, 0);
        results.push({
          staff: s,
          hours,
          base,
          adjustments: adjustments ?? [],
          adjTotal,
          total: base + adjTotal,
        });
      }
      return results;
    },
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
      void qc.invalidateQueries({ queryKey: ["payroll-calc"] });
    },
  });

  const grandTotal = (rows ?? []).reduce((sum, r) => sum + r.total, 0);

  return (
    <div>
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
        </div>
        <div className="text-right">
          <p className="eyebrow">Total del periodo</p>
          <p className="text-2xl">{money(grandTotal)}</p>
        </div>
      </div>

      <ul className="divide-y divide-border border-y border-border text-sm">
        {(rows ?? []).map((r) => (
          <li key={r.staff.id} className="space-y-3 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p>
                  {r.staff.full_name}{" "}
                  <span className="text-muted-foreground">· {r.staff.role}</span>
                </p>
                <p className="text-muted-foreground">
                  {r.hours.toFixed(1)} h trabajadas · {money(r.staff.hourly_rate_cents)}/h →{" "}
                  {money(r.base)}
                </p>
              </div>
              <p className="text-lg">{money(r.total)}</p>
            </div>
            {r.adjustments.length > 0 ? (
              <ul className="ml-4 space-y-1 text-xs text-muted-foreground">
                {r.adjustments.map((a) => (
                  <li key={a.id}>
                    {a.amount_cents >= 0 ? "+" : ""}
                    {money(a.amount_cents)} — {a.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                addAdjustment.mutate({
                  staffId: r.staff.id,
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
                className={`${input} w-32`}
              />
              <input
                name="reason"
                placeholder="Motivo (ej. no-show, bono)"
                className={`${input} w-64`}
              />
              <button className="border border-input px-3 py-2 text-[0.68rem] uppercase tracking-[0.14em]">
                Agregar ajuste
              </button>
            </form>
          </li>
        ))}
      </ul>
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

const COVERAGE_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-destructive",
  none: "bg-transparent",
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
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const cov = dayCoverage(date, slots ?? [], claims ?? []);
          const isSelected = dateKey(date) === dateKey(selected);
          return (
            <button
              key={i}
              onClick={() => setSelected(date)}
              className={`flex aspect-square flex-col items-center justify-center gap-1 border text-sm transition-colors ${
                isSelected ? "border-foreground" : "border-border"
              }`}
            >
              <span>{date.getDate()}</span>
              {cov.color !== "none" ? (
                <span className={`h-2 w-2 rounded-full ${COVERAGE_DOT[cov.color]}`} />
              ) : null}
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
          <p className="mt-3 text-sm text-muted-foreground">
            Sin turnos configurados para este día.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {selectedCoverage.slots.map(({ slot, claims: slotClaims, confirmed, color }) => (
              <div
                key={slot.id}
                className="border-l-4 pl-4"
                style={{
                  borderColor:
                    color === "green" ? "#10b981" : color === "yellow" ? "#fbbf24" : "#dc2626",
                }}
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
                        {c.status === "propuesto" ? (
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
              className={`flex aspect-square flex-col items-center justify-center gap-1 border text-sm transition-colors disabled:opacity-30 ${
                isSelected ? "border-foreground" : "border-border"
              }`}
            >
              <span>{date.getDate()}</span>
              {cov.color !== "none" ? (
                <span className={`h-2 w-2 rounded-full ${COVERAGE_DOT[cov.color]}`} />
              ) : null}
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
export function FinancePanel() {
  const monthStart = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const now = new Date();

  const { data } = useQuery({
    queryKey: ["finance-month", monthStart.toISOString()],
    queryFn: async () => {
      const fromIso = monthStart.toISOString();
      const toIso = now.toISOString();

      const { data: transactions } = await supabase
        .from("transactions")
        .select("amount_cents, status, created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      const clasesRevenue = (transactions ?? [])
        .filter((t) => t.status === "completed")
        .reduce((sum, t) => sum + t.amount_cents, 0);

      const { data: saleItems } = await supabase
        .from("pos_sale_items")
        .select("qty, unit_price_cents, product_id, sale:pos_sales!inner(created_at)")
        .gte("sale.created_at", fromIso)
        .lte("sale.created_at", toIso);
      const productIds = Array.from(
        new Set((saleItems ?? []).map((i) => i.product_id).filter(Boolean)),
      ) as string[];
      const { data: products } = productIds.length
        ? await supabase.from("products").select("id, category").in("id", productIds)
        : { data: [] as { id: string; category: string }[] };
      const categoryById = new Map((products ?? []).map((p) => [p.id, p.category]));

      let merchRevenue = 0;
      let consumibleRevenue = 0;
      let otrosRevenue = 0;
      for (const item of saleItems ?? []) {
        const amount = item.qty * item.unit_price_cents;
        const cat = item.product_id ? categoryById.get(item.product_id) : undefined;
        if (cat === "merch") merchRevenue += amount;
        else if (cat === "consumible" || cat === "suplemento") consumibleRevenue += amount;
        else otrosRevenue += amount;
      }

      const { data: staff } = await supabase.from("staff_profiles").select("*").eq("active", true);
      let payrollCost = 0;
      for (const s of staff ?? []) {
        const { data: seconds } = await supabase.rpc("staff_worked_seconds", {
          _staff_id: s.id,
          _from: fromIso,
          _to: toIso,
        });
        payrollCost += ((seconds ?? 0) / 3600) * s.hourly_rate_cents;
      }
      const { data: adjustments } = await supabase
        .from("payroll_adjustments")
        .select("amount_cents")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      payrollCost += (adjustments ?? []).reduce((sum, a) => sum + a.amount_cents, 0);

      const totalRevenue = clasesRevenue + merchRevenue + consumibleRevenue + otrosRevenue;
      return {
        clasesRevenue,
        merchRevenue,
        consumibleRevenue,
        otrosRevenue,
        totalRevenue,
        payrollCost,
        margin: totalRevenue - payrollCost,
      };
    },
  });

  const marginPositive = (data?.margin ?? 0) >= 0;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Del {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(monthStart)} a hoy.
        Ingresos por transacciones completadas y ventas de mostrador; costo de nómina calculado a
        partir del checador y ajustes manuales.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border p-5">
          <p className="eyebrow">Clases (paquetes/membresías)</p>
          <p className="mt-1 text-xl">{money(data?.clasesRevenue ?? 0)}</p>
        </div>
        <div className="border border-border p-5">
          <p className="eyebrow">Merch</p>
          <p className="mt-1 text-xl">{money(data?.merchRevenue ?? 0)}</p>
        </div>
        <div className="border border-border p-5">
          <p className="eyebrow">Recovery Bar / consumibles</p>
          <p className="mt-1 text-xl">{money(data?.consumibleRevenue ?? 0)}</p>
        </div>
        <div className="border border-border p-5">
          <p className="eyebrow">Otros</p>
          <p className="mt-1 text-xl">{money(data?.otrosRevenue ?? 0)}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border border-border p-6">
          <p className="eyebrow">Ingresos del mes</p>
          <p className="mt-2 text-2xl">{money(data?.totalRevenue ?? 0)}</p>
        </div>
        <div className="border border-border p-6">
          <p className="eyebrow">Costo de nómina del mes</p>
          <p className="mt-2 text-2xl">{money(data?.payrollCost ?? 0)}</p>
        </div>
        <div
          className={`border p-6 ${marginPositive ? "border-emerald-500" : "border-destructive"}`}
        >
          <p className="eyebrow">Margen</p>
          <p
            className={`mt-2 text-2xl ${marginPositive ? "text-emerald-600" : "text-destructive"}`}
          >
            {marginPositive ? "+" : ""}
            {money(data?.margin ?? 0)}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Nota: este margen resta solo el costo de nómina calculado (horas del checador × tarifa, más
        ajustes). No incluye costo de mercancía vendida (lo que costó comprar el inventario), renta,
        ni otros gastos fijos — dime si quieres que lo sumemos también para tener el margen real
        completo.
      </p>
    </div>
  );
}

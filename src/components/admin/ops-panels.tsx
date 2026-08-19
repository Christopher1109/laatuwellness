import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

export const input =
  "w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format((cents ?? 0) / 100);

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ============================================================================
// PUNTO DE VENTA (POS)
// ============================================================================
export function POSPanel() {
  const qc = useQueryClient();
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
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <ul className="divide-y divide-border border-y border-border text-sm">
        {(products ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-4 py-4">
            <div>
              <p>{p.name}</p>
              <p className="text-muted-foreground">
                {money(p.price_cents)} · stock {p.stock}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="border border-input px-3 py-1.5"
                onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}
              >
                −
              </button>
              <span className="w-8 text-center">{cart[p.id] ?? 0}</span>
              <button
                className="border border-input px-3 py-1.5"
                onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}
              >
                +
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="h-fit space-y-4 border border-border p-6">
        <p className="eyebrow">Cobro</p>
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
        <p className="text-lg">{money(total)}</p>
        <button
          disabled={checkout.isPending}
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

  const today = new Date();
  const soon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  return (
    <div>
      <form
        className="grid gap-4 border border-border p-6 sm:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            name: String(f.get("name") || ""),
            category: String(f.get("category") || "merch"),
            price_cents: Math.round(Number(f.get("price") || 0) * 100),
            stock: Number(f.get("stock") || 0),
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
          <input name="category" defaultValue="merch" className={input} />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Precio (MXN)</span>
          <input name="price" type="number" min={0} step="0.01" className={input} />
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
        <div className="sm:col-span-6">
          <button className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
            Agregar producto
          </button>
        </div>
      </form>

      <ul className="mt-8 divide-y divide-border border-y border-border text-sm">
        {(data ?? []).map((p) => {
          const low = p.stock <= p.low_stock_threshold;
          const expiring = p.expires_at ? new Date(p.expires_at) <= soon : false;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <span className="w-48">{p.name}</span>
              <span className="text-muted-foreground">{p.category}</span>
              <span>{money(p.price_cents)}</span>
              <span className={low ? "text-destructive" : ""}>
                Stock {p.stock}
                {low ? " · bajo" : ""}
              </span>
              {p.expires_at ? (
                <span className={expiring ? "text-destructive" : "text-muted-foreground"}>
                  Caduca{" "}
                  {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
                    new Date(p.expires_at),
                  )}
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  className="border border-input px-3 py-1.5"
                  onClick={() => adjust.mutate({ id: p.id, delta: -1, reason: "Salida manual" })}
                >
                  −
                </button>
                <button
                  className="border border-input px-3 py-1.5"
                  onClick={() => adjust.mutate({ id: p.id, delta: 1, reason: "Entrada manual" })}
                >
                  +
                </button>
                <button
                  className="border border-input px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em]"
                  onClick={() => update.mutate({ id: p.id, patch: { active: !p.active } })}
                >
                  {p.active ? "Ocultar" : "Publicar"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// CHECK-IN
// ============================================================================
export function CheckInPanel() {
  const qc = useQueryClient();
  const [classId, setClassId] = useState<string>("");

  const { data: classes } = useQuery({
    queryKey: ["checkin-classes"],
    queryFn: async () => {
      const from = new Date();
      from.setHours(from.getHours() - 3);
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .gte("starts_at", from.toISOString())
        .order("starts_at")
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

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

  return (
    <div>
      <label className="block text-xs">
        <span className="eyebrow">Clase</span>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className={input}>
          <option value="">Selecciona una clase</option>
          {(classes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(c.starts_at),
              )}{" "}
              · {c.room} · {c.instructor}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-8 divide-y divide-border border-y border-border text-sm">
        {(rows ?? []).map((r) => (
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
        {classId && (rows ?? []).length === 0 ? (
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
      <form
        className="grid gap-4 border border-border p-6 sm:grid-cols-5"
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

      <ul className="mt-8 divide-y divide-border border-y border-border text-sm">
        {(data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p>
                {s.full_name} <span className="text-muted-foreground">· {s.role}</span>
              </p>
              <p className="text-muted-foreground">
                {s.email}
                {s.user_id ? "" : " · aún no ha iniciado sesión"}
              </p>
            </div>
            <div className="flex items-center gap-4">
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
      const { error } = await supabase.from("payroll_adjustments").insert({
        staff_id: staffId,
        amount_cents: Math.round(amount * 100),
        reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste registrado.");
      void qc.invalidateQueries({ queryKey: ["payroll-calc"] });
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 border border-border p-6">
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
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
      </div>

      <ul className="mt-8 divide-y divide-border border-y border-border text-sm">
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
// HORARIOS DE STAFF: turnos requeridos (admin) + disponibilidad (self-service)
// ============================================================================
export function ShiftSchedulePanel() {
  const qc = useQueryClient();
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
  const { data: claims } = useQuery({
    queryKey: ["admin-shift-claims"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_claims")
        .select("*, staff:staff_profiles(full_name)");
      if (error) throw error;
      return data as (Tables<"shift_claims"> & { staff: { full_name: string } | null })[];
    },
  });

  const createSlot = useMutation({
    mutationFn: async (payload: {
      weekday: number;
      start_time: string;
      end_time: string;
      role_needed: "admin" | "staff" | "coach";
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

  return (
    <div className="space-y-10">
      <form
        className="grid gap-4 border border-border p-6 sm:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          createSlot.mutate({
            weekday: Number(f.get("weekday")),
            start_time: String(f.get("start_time")),
            end_time: String(f.get("end_time")),
            role_needed: String(f.get("role_needed")) as "admin" | "staff" | "coach",
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
        <label className="text-xs sm:col-span-2">
          <span className="eyebrow">Notas</span>
          <input name="notes" className={input} />
        </label>
        <div className="sm:col-span-6">
          <button className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background">
            Publicar turno requerido
          </button>
        </div>
      </form>

      <ul className="divide-y divide-border border-y border-border text-sm">
        {(slots ?? []).map((s) => {
          const slotClaims = (claims ?? []).filter((c) => c.shift_slot_id === s.id);
          return (
            <li key={s.id} className="space-y-2 py-4">
              <p>
                {WEEKDAYS[s.weekday]} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{" "}
                <span className="text-muted-foreground">
                  · {s.role_needed} · {s.notes}
                </span>
              </p>
              {slotClaims.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nadie ha propuesto cubrirlo.</p>
              ) : (
                <ul className="ml-4 space-y-1">
                  {slotClaims.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 text-xs">
                      <span>{c.staff?.full_name}</span>
                      <span className="text-muted-foreground">{c.status}</span>
                      {c.status === "propuesto" ? (
                        <>
                          <button
                            onClick={() => setClaim.mutate({ id: c.id, status: "confirmado" })}
                            className="border border-input px-2 py-1"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => setClaim.mutate({ id: c.id, status: "rechazado" })}
                            className="border border-input px-2 py-1 text-destructive"
                          >
                            Rechazar
                          </button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MyAvailabilityPanel() {
  const { staffProfile } = useAuth();
  const qc = useQueryClient();
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
  const { data: myClaims } = useQuery({
    queryKey: ["my-shift-claims", staffProfile?.id],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_claims")
        .select("*")
        .eq("staff_id", staffProfile!.id);
      if (error) throw error;
      return data;
    },
  });

  const claim = useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await supabase
        .from("shift_claims")
        .insert({ shift_slot_id: slotId, staff_id: staffProfile!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Disponibilidad enviada. Espera confirmación del admin.");
      void qc.invalidateQueries({ queryKey: ["my-shift-claims"] });
    },
  });

  return (
    <ul className="divide-y divide-border border-y border-border text-sm">
      {(slots ?? []).map((s) => {
        const mine = (myClaims ?? []).find((c) => c.shift_slot_id === s.id);
        return (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <span>
              {WEEKDAYS[s.weekday]} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{" "}
              <span className="text-muted-foreground">{s.notes}</span>
            </span>
            {mine ? (
              <span className="text-muted-foreground">{mine.status}</span>
            ) : (
              <button
                onClick={() => claim.mutate(s.id)}
                className="border border-input px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.14em]"
              >
                Puedo cubrirlo
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================================
// CHECADOR: entrada / salida con foto
// ============================================================================
export function TimeClockPanel() {
  const { staffProfile } = useAuth();
  const qc = useQueryClient();

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
    mutationFn: async ({ type, file }: { type: "in" | "out"; file: File | null }) => {
      let photo_url: string | null = null;
      if (file) {
        const path = `${staffProfile!.id}/${Date.now()}-${type}.jpg`;
        const { error: upErr } = await supabase.storage.from("staff-photos").upload(path, file);
        if (upErr) throw upErr;
        photo_url = path;
      }
      const { error } = await supabase
        .from("time_clock_entries")
        .insert({ staff_id: staffProfile!.id, type, photo_url });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.type === "in" ? "Entrada registrada." : "Salida registrada.");
      void qc.invalidateQueries({ queryKey: ["my-clock"] });
    },
    onError: () => toast.error("No se pudo registrar. Intenta de nuevo."),
  });

  const lastType = today?.[today.length - 1]?.type;
  const nextType: "in" | "out" = lastType === "in" ? "out" : "in";

  return (
    <div className="max-w-md space-y-6 border border-border p-6">
      <p className="eyebrow">Checador — {staffProfile?.full_name}</p>
      <label className="block text-xs">
        <span className="eyebrow">
          {nextType === "in" ? "Foto para marcar entrada" : "Foto para marcar salida"}
        </span>
        <input
          type="file"
          accept="image/*"
          capture="user"
          id="clock-photo"
          className={input}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            punch.mutate({ type: nextType, file });
          }}
        />
      </label>
      <button
        onClick={() => punch.mutate({ type: nextType, file: null })}
        className="w-full border border-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em]"
      >
        Marcar {nextType === "in" ? "entrada" : "salida"} sin foto
      </button>

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

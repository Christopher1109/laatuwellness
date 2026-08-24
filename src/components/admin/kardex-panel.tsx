import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type LogRow = {
  id: string;
  category: string;
  action: string;
  description: string;
  amount_cents: number | null;
  created_at: string;
  actor_id: string | null;
  subject_user_id: string | null;
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "todo", label: "Todo" },
  { key: "compras", label: "Compras de paquetes" },
  { key: "ventas", label: "Ventas / merch" },
  { key: "tokens", label: "Créditos" },
  { key: "reservas", label: "Reservas y lugares" },
  { key: "asistencia", label: "Asistencia / check-in" },
  { key: "inventario", label: "Inventario e insumos" },
  { key: "clases", label: "Clases" },
  { key: "modificaciones", label: "Modificaciones" },
];

const ACTION_LABELS: Record<string, string> = {
  compra_paquete: "Compra de paquete",
  venta_pos: "Venta punto de venta",
  creditos_agregados: "Créditos agregados",
  creditos_usados: "Créditos usados",
  reserva: "Reserva",
  lista_espera: "Lista de espera",
  cancelacion: "Cancelación",
  cambio_estado: "Cambio de estado",
  asignacion_lugar: "Asignación de lugar",
  check_in: "Check-in",
  no_asistio: "No asistió",
  entrada_insumo: "Entrada de insumo",
  salida_insumo: "Salida de insumo",
  producto_creado: "Producto creado",
  producto_editado: "Producto editado",
  clase_creada: "Clase creada",
  clase_editada: "Clase editada",
  clase_borrada: "Clase borrada",
};

function money(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(cents / 100);
}

function when(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

const RANGES = [
  { key: "7", label: "7 días" },
  { key: "30", label: "30 días" },
  { key: "90", label: "90 días" },
  { key: "todo", label: "Todo" },
];

export function KardexPanel() {
  const [category, setCategory] = useState("todo");
  const [range, setRange] = useState("30");
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["kardex", category, range],
    queryFn: async () => {
      let q = supabase
        .from("activity_log")
        .select(
          "id, category, action, description, amount_cents, created_at, actor_id, subject_user_id",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (category !== "todo") q = q.eq("category", category);
      if (range !== "todo") {
        const from = new Date(Date.now() - Number(range) * 86400000).toISOString();
        q = q.gte("created_at", from);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as LogRow[];
    },
  });

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return data ?? [];
    return (data ?? []).filter(
      (r) =>
        r.description.toLowerCase().includes(term) ||
        (ACTION_LABELS[r.action] ?? r.action).toLowerCase().includes(term),
    );
  }, [data, query]);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-2">Categoría</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={cn(
                "border px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.1em]",
                category === c.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-input hover:bg-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="eyebrow mb-2">Periodo</p>
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "border px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.1em]",
                  range === r.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-input hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-[16rem] flex-1">
          <p className="eyebrow mb-2">Buscar</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, producto, acción…"
            className="w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground"
          />
        </div>
      </div>

      <div className="border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Categoría</th>
              <th className="px-4 py-2.5">Acción</th>
              <th className="px-4 py-2.5">Detalle</th>
              <th className="px-4 py-2.5 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                  {when(r.created_at)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="bg-muted px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.08em]">
                    {CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {ACTION_LABELS[r.action] ?? r.action}
                </td>
                <td className="px-4 py-2.5">{r.description}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.amount_cents != null ? money(r.amount_cents) : "—"}
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Sin movimientos en este filtro.
                </td>
              </tr>
            ) : null}
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[0.65rem] text-muted-foreground">
        El kardex registra automáticamente cada acción del sistema: compras de paquetes, ventas,
        créditos, reservas y lugares, check-in y ausencias, inventario y cambios de catálogo. Se
        muestran los últimos 500 movimientos del periodo elegido.
      </p>
    </div>
  );
}

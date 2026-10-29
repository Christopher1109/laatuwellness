import { supabase } from "@/integrations/supabase/client";
import logoUrl from "@/assets/laatu-wordmark-ink.png";
import {
  buildIncomeWorkbook,
  PAYMENT_LABELS,
  PLAN_CATEGORY_LABELS,
  type IncomeRow,
  type Segment,
} from "@/lib/finance-workbook";
import { splitByPayment } from "@/lib/pos-money";

// ============================================================================
// Reporte de ingresos en Excel: resumen con logo, segmentos, métodos de pago,
// paquetes, productos, ingresos por día y el detalle completo con filtros.
// ============================================================================

function originFromRef(ref: string | null | undefined, orderCode?: string | null) {
  const r = ref ?? "";
  if (orderCode) return "En línea";
  if (r.startsWith("pinpad_")) return "Mostrador · terminal";
  if (r.startsWith("pos_cash_")) return "Mostrador";
  if (r === "" || r.startsWith("admin")) return "Mostrador";
  return "En línea";
}

/** Lee todas las ventas completadas del periodo (paquetes y productos). */
export async function fetchIncomeRows(from: Date, to: Date): Promise<IncomeRow[]> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .select(
      "created_at, amount_cents, payment_method, payment_split, external_ref, user_id, plan:token_plans(name, category)",
    )
    .eq("status", "completed")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at");
  if (txError) throw txError;

  const { data: items, error: itemsError } = await supabase
    .from("pos_sale_items")
    .select(
      "qty, unit_price_cents, description, product_id, sale:pos_sales!inner(created_at, user_id, status, payment_method, payment_split, order_code, external_ref, brand)",
    )
    .neq("sale.status", "reembolsado")
    .gte("sale.created_at", fromIso)
    .lte("sale.created_at", toIso);
  if (itemsError) throw itemsError;

  const productIds = Array.from(
    new Set((items ?? []).map((i) => i.product_id).filter(Boolean)),
  ) as string[];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name, category, brand").in("id", productIds)
    : { data: [] as { id: string; name: string; category: string; brand: string | null }[] };
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const userIds = Array.from(
    new Set(
      [...(tx ?? []).map((t) => t.user_id), ...(items ?? []).map((i) => i.sale?.user_id)].filter(
        Boolean,
      ),
    ),
  ) as string[];
  const profileById = new Map<string, { full_name: string; email: string }>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds.slice(i, i + 200));
    for (const p of profiles ?? []) profileById.set(p.id, p);
  }
  const who = (id: string | null | undefined) => {
    const p = id ? profileById.get(id) : undefined;
    return {
      client: p?.full_name || p?.email || (id ? "Cliente" : "Sin cliente"),
      email: p?.email ?? "",
    };
  };

  const rows: IncomeRow[] = [];
  // Pago mixto: un renglón por método (tarjeta / efectivo / transferencia)
  // para que el resumen por método de pago cuadre. Las unidades se cuentan
  // solo en el primero.
  const pushSplit = (row: IncomeRow, method: string, split: unknown) => {
    const parts = method === "mixto" ? splitByPayment(row.amountCents, split) : null;
    if (!parts) {
      rows.push({ ...row, method: PAYMENT_LABELS[method] ?? method });
      return;
    }
    parts.forEach((p, i) => {
      rows.push({
        ...row,
        concept: `${row.concept} (pago mixto)`,
        method: PAYMENT_LABELS[p.method] ?? p.method,
        qty: i === 0 ? row.qty : 0,
        amountCents: p.cents,
      });
    });
  };
  for (const t of tx ?? []) {
    const category = t.plan?.category ?? "clases_pilates";
    pushSplit(
      {
        date: new Date(t.created_at),
        segment: "Paquetes y membresías",
        concept: t.plan?.name ?? "Paquete",
        category: PLAN_CATEGORY_LABELS[category] ?? category,
        ...who(t.user_id),
        method: "",
        origin: originFromRef(t.external_ref),
        qty: 1,
        unitCents: t.amount_cents,
        amountCents: t.amount_cents,
      },
      t.payment_method,
      t.payment_split,
    );
  }
  for (const it of items ?? []) {
    if (!it.sale) continue;
    const product = it.product_id ? productById.get(it.product_id) : undefined;
    const brand = product?.brand ?? it.sale.brand ?? "laatu";
    const category = product?.category ?? "otro";
    // Sin producto = cobro de monto libre desde el punto de venta.
    const isFree = !it.product_id;
    const segment: Segment =
      brand === "goodes" || category === "goodes"
        ? "Goddess"
        : isFree
          ? "Otros cobros"
          : category === "merch"
            ? "Merch"
            : "Consumibles";
    pushSplit(
      {
        date: new Date(it.sale.created_at),
        segment,
        concept: product?.name ?? it.description ?? (isFree ? "Cobro libre" : "Producto"),
        category:
          segment === "Goddess"
            ? isFree
              ? "Goddess · cobro libre"
              : "Goddess"
            : isFree
              ? "Cobro libre"
              : category === "merch"
                ? "Merch"
                : category === "suplemento"
                  ? "Suplementos"
                  : "Consumibles",
        ...who(it.sale.user_id),
        method: "",
        origin: originFromRef(it.sale.external_ref, it.sale.order_code),
        qty: it.qty,
        unitCents: it.unit_price_cents,
        amountCents: it.qty * it.unit_price_cents,
      },
      it.sale.payment_method,
      it.sale.payment_split,
    );
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
}

async function loadLogo(): Promise<Uint8Array | undefined> {
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Descarga el reporte de ingresos del periodo como .xlsx. */
export async function downloadIncomeReport(from: Date, to: Date) {
  const [rows, logo] = await Promise.all([fetchIncomeRows(from, to), loadLogo()]);
  const bytes = buildIncomeWorkbook(rows, { from, to, ...(logo ? { logo } : {}) });
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `Laatu-ingresos-${stamp(from)}-a-${stamp(to)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}

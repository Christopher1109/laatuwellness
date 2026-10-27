import {
  buildXlsx,
  colName,
  type XlsxCell,
  type XlsxSheet,
  type XlsxStyle,
} from "@/lib/xlsx-writer";

// ============================================================================
// Libro de Excel del reporte de ingresos: resumen, detalle, paquetes y días.
// Funciones puras (sin red) para poder probarlas.
// ============================================================================

export const PLAN_CATEGORY_LABELS: Record<string, string> = {
  clases_pilates: "Clases de Pilates",
  membresia: "Membresías",
  consulta: "Consulta (Align)",
  recuperacion: "Recuperación (Contrast)",
};

export const PAYMENT_LABELS: Record<string, string> = {
  tarjeta: "Tarjeta",
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  convenio: "Convenio (sin cobro)",
  saldo: "Saldo / ajuste",
  pendiente: "Pendiente",
  en_estudio: "Pago en estudio",
};

export type Segment = "Paquetes y membresías" | "Merch" | "Consumibles" | "Goddess";
export const LAATU_SEGMENTS: Segment[] = ["Paquetes y membresías", "Merch", "Consumibles"];

export type IncomeRow = {
  date: Date;
  segment: Segment;
  concept: string;
  category: string;
  client: string;
  email: string;
  method: string;
  origin: string;
  qty: number;
  unitCents: number;
  amountCents: number;
};

const pesos = (cents: number) => Math.round(cents) / 100;

type Agg = { key: string; count: number; amount: number; extra?: string | undefined };
function aggregate(
  rows: IncomeRow[],
  keyOf: (r: IncomeRow) => string,
  extraOf?: (r: IncomeRow) => string,
) {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const key = keyOf(r);
    const acc = map.get(key) ?? { key, count: 0, amount: 0, extra: extraOf?.(r) };
    acc.count += r.qty;
    acc.amount += r.amountCents;
    map.set(key, acc);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

const alt = (style: XlsxStyle, i: number): XlsxStyle =>
  i % 2 === 1 ? (`${style}Alt` as XlsxStyle) : style;

const dayFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "long" });
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Arma el libro de Excel a partir de las filas de ingreso. */
export function buildIncomeWorkbook(
  rows: IncomeRow[],
  opts: { from: Date; to: Date; logo?: Uint8Array },
): Uint8Array {
  const laatuRows = rows.filter((r) => r.segment !== "Goddess");
  const goddessRows = rows.filter((r) => r.segment === "Goddess");
  const laatuTotal = laatuRows.reduce((s, r) => s + r.amountCents, 0);
  const goddessTotal = goddessRows.reduce((s, r) => s + r.amountCents, 0);
  const grandTotal = laatuTotal + goddessTotal;
  const uniqueClients = new Set(laatuRows.filter((r) => r.email).map((r) => r.email)).size;
  const paidPackages = laatuRows.filter(
    (r) => r.segment === "Paquetes y membresías" && r.amountCents > 0,
  );
  const operations = laatuRows.length;
  const avgTicket = operations ? laatuTotal / operations : 0;

  const period = `Del ${dayFmt.format(opts.from)} al ${dayFmt.format(opts.to)}`;
  const generated = `Generado el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`;

  // ---------------------------------------------------------------- Resumen
  const W = 5; // columnas usadas en el resumen (A..E)
  const r: (XlsxCell | null)[][] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  const blank = () => r.push([]);
  const line = (cells: (XlsxCell | null)[]) => r.push(cells);
  const mergeRow = (row: number) => merges.push(`A${row + 1}:${colName(W - 1)}${row + 1}`);

  // Espacio para el logo (filas 0-3)
  for (let i = 0; i < 4; i++) blank();
  heights[0] = 22;
  heights[1] = 22;
  heights[2] = 22;
  line([{ v: "Reporte de ingresos", s: "title" }]);
  heights[r.length - 1] = 30;
  mergeRow(r.length - 1);
  line([{ v: period, s: "subtitle" }]);
  mergeRow(r.length - 1);
  line([{ v: generated, s: "subtitle" }]);
  mergeRow(r.length - 1);
  blank();

  // KPIs
  line([
    { v: "INGRESOS LÄÄTU", s: "kpiLabel" },
    { v: "OPERACIONES", s: "kpiLabel" },
    { v: "TICKET PROMEDIO", s: "kpiLabel" },
    { v: "CLIENTES", s: "kpiLabel" },
    { v: "PAQUETES VENDIDOS", s: "kpiLabel" },
  ]);
  line([
    { v: pesos(laatuTotal), s: "kpiValue" },
    { v: operations, s: "kpiInt" },
    { v: pesos(avgTicket), s: "kpiValue" },
    { v: uniqueClients, s: "kpiInt" },
    { v: paidPackages.length, s: "kpiInt" },
  ]);
  heights[r.length - 1] = 28;
  blank();

  const section = (title: string) => {
    line([
      { v: title, s: "section" },
      { v: "", s: "section" },
      { v: "", s: "section" },
      { v: "", s: "section" },
      { v: "", s: "section" },
    ]);
    mergeRow(r.length - 1);
    heights[r.length - 1] = 22;
  };
  const header = (labels: string[], rightFrom: number) =>
    line(
      Array.from({ length: W }, (_, i) => ({
        v: labels[i] ?? "",
        s: (i >= rightFrom ? "headerRight" : "header") as XlsxStyle,
      })),
    );

  // Segmentos
  section("Ingresos por segmento");
  header(["Segmento", "", "Operaciones", "Ingreso", "% de Läätu"], 2);
  LAATU_SEGMENTS.forEach((seg, i) => {
    const segRows = laatuRows.filter((x) => x.segment === seg);
    const amount = segRows.reduce((s, x) => s + x.amountCents, 0);
    line([
      { v: seg, s: alt("text", i) },
      { v: "", s: alt("text", i) },
      { v: segRows.reduce((s, x) => s + x.qty, 0), s: alt("int", i) },
      { v: pesos(amount), s: alt("money", i) },
      { v: laatuTotal ? amount / laatuTotal : 0, s: alt("pct", i) },
    ]);
    merges.push(`A${r.length}:B${r.length}`);
  });
  line([
    { v: "Total Läätu", s: "totalLabel" },
    { v: "", s: "totalLabel" },
    { v: laatuRows.reduce((s, x) => s + x.qty, 0), s: "totalInt" },
    { v: pesos(laatuTotal), s: "totalMoney" },
    { v: laatuTotal ? 1 : 0, s: "totalPct" },
  ]);
  merges.push(`A${r.length}:B${r.length}`);
  if (goddessRows.length > 0) {
    line([
      { v: "Goddess (marca aparte, terminal propia)", s: "muted" },
      { v: "", s: "muted" },
      { v: goddessRows.reduce((s, x) => s + x.qty, 0), s: "int" },
      { v: pesos(goddessTotal), s: "money" },
      { v: "", s: "muted" },
    ]);
    merges.push(`A${r.length}:B${r.length}`);
    line([
      { v: "Total general (Läätu + Goddess)", s: "totalLabel" },
      { v: "", s: "totalLabel" },
      { v: rows.reduce((s, x) => s + x.qty, 0), s: "totalInt" },
      { v: pesos(grandTotal), s: "totalMoney" },
      { v: "", s: "totalLabel" },
    ]);
    merges.push(`A${r.length}:B${r.length}`);
  }
  blank();

  // Métodos de pago
  section("Por método de pago (Läätu)");
  header(["Método", "", "Operaciones", "Ingreso", "% de Läätu"], 2);
  aggregate(laatuRows, (x) => x.method).forEach((a, i) => {
    line([
      { v: a.key, s: alt("text", i) },
      { v: "", s: alt("text", i) },
      { v: a.count, s: alt("int", i) },
      { v: pesos(a.amount), s: alt("money", i) },
      { v: laatuTotal ? a.amount / laatuTotal : 0, s: alt("pct", i) },
    ]);
    merges.push(`A${r.length}:B${r.length}`);
  });
  blank();

  // Paquetes
  section("Paquetes y membresías");
  header(["Paquete", "Categoría", "Ventas", "Ingreso", "% de paquetes"], 2);
  const pkgRows = laatuRows.filter((x) => x.segment === "Paquetes y membresías");
  const pkgTotal = pkgRows.reduce((s, x) => s + x.amountCents, 0);
  const pkgAgg = aggregate(
    pkgRows,
    (x) => x.concept,
    (x) => x.category,
  );
  pkgAgg.forEach((a, i) => {
    line([
      { v: a.key, s: alt("text", i) },
      { v: a.extra ?? "", s: alt("muted", i) },
      { v: a.count, s: alt("int", i) },
      { v: pesos(a.amount), s: alt("money", i) },
      { v: pkgTotal ? a.amount / pkgTotal : 0, s: alt("pct", i) },
    ]);
  });
  if (pkgAgg.length === 0) line([{ v: "Sin ventas de paquetes en el periodo.", s: "muted" }]);
  blank();

  // Productos más vendidos
  section("Productos más vendidos");
  header(["Producto", "Segmento", "Unidades", "Ingreso", "% de productos"], 2);
  const prodRows = rows.filter((x) => x.segment !== "Paquetes y membresías");
  const prodTotal = prodRows.reduce((s, x) => s + x.amountCents, 0);
  const prodAgg = aggregate(
    prodRows,
    (x) => x.concept,
    (x) => x.segment,
  ).slice(0, 15);
  prodAgg.forEach((a, i) => {
    line([
      { v: a.key, s: alt("text", i) },
      { v: a.extra ?? "", s: alt("muted", i) },
      { v: a.count, s: alt("int", i) },
      { v: pesos(a.amount), s: alt("money", i) },
      { v: prodTotal ? a.amount / prodTotal : 0, s: alt("pct", i) },
    ]);
  });
  if (prodAgg.length === 0) line([{ v: "Sin ventas de productos en el periodo.", s: "muted" }]);
  blank();
  line([
    {
      v: "Los montos son ventas completadas (sin reembolsos). Goddess se cobra en su propia terminal y se reporta aparte del total de Läätu. El detalle completo está en la hoja «Detalle».",
      s: "note",
    },
  ]);
  mergeRow(r.length - 1);
  heights[r.length - 1] = 32;

  const resumen: XlsxSheet = {
    name: "Resumen",
    rows: r,
    cols: [32, 22, 22, 20, 20],
    merges,
    rowHeights: heights,
    tabColor: "FF272839",
    ...(opts.logo
      ? { image: { data: opts.logo, col: 0, row: 0, widthPx: 210, heightPx: 83 } }
      : {}),
  };

  // ---------------------------------------------------------------- Detalle
  const detailHeader = [
    "Fecha",
    "Segmento",
    "Concepto",
    "Categoría",
    "Cliente",
    "Correo",
    "Método de pago",
    "Origen",
    "Cantidad",
    "Precio unitario",
    "Importe",
  ];
  const detailRows: (XlsxCell | null)[][] = [
    detailHeader.map((h, i) => ({ v: h, s: (i >= 8 ? "headerRight" : "header") as XlsxStyle })),
    ...rows.map((x, i) => [
      { v: x.date, s: alt("date", i) },
      { v: x.segment, s: alt("text", i) },
      { v: x.concept, s: alt("text", i) },
      { v: x.category, s: alt("muted", i) },
      { v: x.client, s: alt("text", i) },
      { v: x.email, s: alt("muted", i) },
      { v: x.method, s: alt("text", i) },
      { v: x.origin, s: alt("muted", i) },
      { v: x.qty, s: alt("int", i) },
      { v: pesos(x.unitCents), s: alt("money", i) },
      { v: pesos(x.amountCents), s: alt("money", i) },
    ]),
  ];
  const lastDetail = rows.length + 1;
  detailRows.push([
    { v: "Total", s: "totalLabel" },
    ...Array.from({ length: 7 }, () => ({ v: "", s: "totalLabel" as XlsxStyle })),
    { v: rows.reduce((s, x) => s + x.qty, 0), s: "totalInt" },
    { v: "", s: "totalLabel" },
    { v: pesos(grandTotal), s: "totalMoney" },
  ]);
  const detalle: XlsxSheet = {
    name: "Detalle",
    rows: detailRows,
    cols: [18, 20, 30, 20, 26, 30, 16, 20, 10, 15, 15],
    freeze: { rows: 1 },
    autoFilter: `A1:K${lastDetail}`,
    rowHeights: { 0: 24 },
    tabColor: "FF8A9AAB",
  };

  // ---------------------------------------------------------------- Paquetes
  const pkgSheetRows: (XlsxCell | null)[][] = [
    [
      "Fecha",
      "Cliente",
      "Correo",
      "Paquete",
      "Categoría",
      "Método de pago",
      "Origen",
      "Importe",
    ].map((h, i) => ({ v: h, s: (i === 7 ? "headerRight" : "header") as XlsxStyle })),
    ...pkgRows.map((x, i) => [
      { v: x.date, s: alt("date", i) },
      { v: x.client, s: alt("text", i) },
      { v: x.email, s: alt("muted", i) },
      { v: x.concept, s: alt("text", i) },
      { v: x.category, s: alt("muted", i) },
      { v: x.method, s: alt("text", i) },
      { v: x.origin, s: alt("muted", i) },
      { v: pesos(x.amountCents), s: alt("money", i) },
    ]),
  ];
  pkgSheetRows.push([
    { v: `${pkgRows.length} compras`, s: "totalLabel" },
    ...Array.from({ length: 6 }, () => ({ v: "", s: "totalLabel" as XlsxStyle })),
    { v: pesos(pkgTotal), s: "totalMoney" },
  ]);
  const paquetes: XlsxSheet = {
    name: "Paquetes",
    rows: pkgSheetRows,
    cols: [18, 26, 30, 26, 22, 16, 20, 15],
    freeze: { rows: 1 },
    autoFilter: `A1:H${pkgRows.length + 1}`,
    rowHeights: { 0: 24 },
  };

  // ---------------------------------------------------------------- Por día
  const days = new Map<string, { date: Date; bySeg: Map<Segment, number> }>();
  for (const x of rows) {
    const k = dayKey(x.date);
    const acc = days.get(k) ?? {
      date: new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate()),
      bySeg: new Map(),
    };
    acc.bySeg.set(x.segment, (acc.bySeg.get(x.segment) ?? 0) + x.amountCents);
    days.set(k, acc);
  }
  const segs: Segment[] = [
    ...LAATU_SEGMENTS,
    ...(goddessRows.length ? (["Goddess"] as Segment[]) : []),
  ];
  const dayHeader = ["Día", ...segs, "Total Läätu"];
  const dayList = Array.from(days.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const dayRows: (XlsxCell | null)[][] = [
    dayHeader.map((h, i) => ({ v: h, s: (i === 0 ? "header" : "headerRight") as XlsxStyle })),
    ...dayList.map((d, i) => [
      { v: dayFmt.format(d.date), s: alt("text", i) },
      ...segs.map((s) => ({ v: pesos(d.bySeg.get(s) ?? 0), s: alt("money", i) })),
      {
        v: pesos(LAATU_SEGMENTS.reduce((sum, s) => sum + (d.bySeg.get(s) ?? 0), 0)),
        s: alt("money", i),
      },
    ]),
  ];
  dayRows.push([
    { v: "Total", s: "totalLabel" },
    ...segs.map((s) => ({
      v: pesos(rows.filter((x) => x.segment === s).reduce((sum, x) => sum + x.amountCents, 0)),
      s: "totalMoney" as XlsxStyle,
    })),
    { v: pesos(laatuTotal), s: "totalMoney" },
  ]);
  const porDia: XlsxSheet = {
    name: "Por día",
    rows: dayRows,
    cols: [26, ...segs.map(() => 20), 18],
    freeze: { rows: 1 },
    rowHeights: { 0: 24 },
  };

  return buildXlsx([resumen, detalle, paquetes, porDia], {
    title: `Reporte de ingresos · ${period}`,
  });
}

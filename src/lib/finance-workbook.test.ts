import { describe, expect, it } from "vitest";
import { buildIncomeWorkbook, type IncomeRow } from "./finance-workbook";

const row = (over: Partial<IncomeRow>): IncomeRow => ({
  date: new Date(2026, 9, 26, 10, 30),
  segment: "Paquetes y membresías",
  concept: "Newcomer",
  category: "Clases de Pilates",
  client: "Ana López",
  email: "ana@example.com",
  method: "Tarjeta",
  origin: "En línea",
  qty: 1,
  unitCents: 45000,
  amountCents: 45000,
  ...over,
});

function readZipEntries(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen;
    out.set(name, dec.decode(bytes.subarray(start, start + size)));
    p = start + size;
  }
  return out;
}

describe("reporte de ingresos en Excel", () => {
  it("arma las cuatro hojas con totales y separa Goddess del total de Läätu", () => {
    const bytes = buildIncomeWorkbook(
      [
        row({}),
        row({
          concept: "Founders Access",
          category: "Membresías",
          amountCents: 400000,
          unitCents: 400000,
          method: "Transferencia",
        }),
        row({
          segment: "Merch",
          concept: "Toalla para mat",
          category: "Merch",
          amountCents: 30000,
          unitCents: 30000,
        }),
        row({
          segment: "Goddess",
          concept: "Replenish Blueberry",
          category: "Goddess",
          amountCents: 70000,
          unitCents: 70000,
        }),
      ],
      {
        from: new Date(2026, 9, 1),
        to: new Date(2026, 9, 31),
        logo: new Uint8Array([137, 80, 78, 71]),
      },
    );
    const files = readZipEntries(bytes);
    expect(files.has("xl/workbook.xml")).toBe(true);
    expect(files.get("xl/workbook.xml")).toContain('name="Resumen"');
    expect(files.get("xl/workbook.xml")).toContain('name="Por día"');
    expect(files.has("xl/media/image1.png")).toBe(true);
    const resumen = files.get("xl/worksheets/sheet1.xml")!;
    expect(resumen).toContain("Total Läätu");
    expect(resumen).toContain("<v>4750</v>"); // 450 + 4000 + 300
    expect(resumen).toContain("Goddess (marca aparte, terminal propia)");
    const paquetes = files.get("xl/worksheets/sheet3.xml")!;
    expect(paquetes).toContain("Founders Access");
    expect(paquetes).toContain("Transferencia");
    expect(paquetes).not.toContain("Toalla para mat");
  });
});

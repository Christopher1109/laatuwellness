/**
 * Generador mínimo de archivos .xlsx con estilos e imagen, sin dependencias.
 * Escribe el XML de Office Open directamente y lo empaqueta en un ZIP sin
 * compresión. Pensado para reportes del panel (finanzas), no para hojas
 * enormes.
 */

export type XlsxStyle =
  | "default"
  | "title"
  | "subtitle"
  | "section"
  | "header"
  | "headerRight"
  | "text"
  | "textAlt"
  | "muted"
  | "mutedAlt"
  | "money"
  | "moneyAlt"
  | "int"
  | "intAlt"
  | "date"
  | "dateAlt"
  | "pct"
  | "pctAlt"
  | "totalLabel"
  | "totalMoney"
  | "totalInt"
  | "totalPct"
  | "kpiLabel"
  | "kpiValue"
  | "kpiInt"
  | "note";

export type XlsxCell = {
  v: string | number | Date | null;
  s?: XlsxStyle;
};

export type XlsxImage = {
  data: Uint8Array;
  /** Columna y fila (base 0) de la esquina superior izquierda. */
  col: number;
  row: number;
  widthPx: number;
  heightPx: number;
};

export type XlsxSheet = {
  name: string;
  rows: (XlsxCell | null)[][];
  /** Ancho de cada columna en caracteres. */
  cols?: number[];
  /** Rangos combinados, ej. "A1:F1". */
  merges?: string[];
  /** Alto por fila (base 0) en puntos. */
  rowHeights?: Record<number, number>;
  /** Congela filas/columnas: número de filas y columnas fijas. */
  freeze?: { rows: number; cols?: number };
  autoFilter?: string;
  image?: XlsxImage;
  tabColor?: string;
};

// --- Paleta Läätu -----------------------------------------------------------
const NAVY = "FF272839";
const STONE = "FF8A9AAB";
const IVORY = "FFF8F7F1";
const SAND = "FFEDEBE3";
const WHITE = "FFFFFFFF";
const GRAY = "FF6B7280";
const LINE = "FFDAD7CC";

// --- Tabla de estilos -------------------------------------------------------
type FontDef = { sz: number; bold?: boolean; color: string; italic?: boolean };
type StyleDef = {
  font: FontDef;
  fill?: string | undefined;
  border?: "bottom" | "top" | "none";
  numFmt?: number;
  align?: "left" | "right" | "center";
  wrap?: boolean;
};

const FMT_MONEY = 164;
const FMT_DATE = 165;
const FMT_INT = 166;
const FMT_PCT = 167;
const NUM_FMTS: Record<number, string> = {
  [FMT_MONEY]: '"$"#,##0.00',
  [FMT_DATE]: "dd/mm/yyyy hh:mm",
  [FMT_INT]: "#,##0",
  [FMT_PCT]: "0.0%",
};

const body = (alt: boolean, extra: Partial<StyleDef> = {}): StyleDef => ({
  font: { sz: 10, color: NAVY },
  fill: alt ? IVORY : undefined,
  border: "bottom",
  ...extra,
});

const STYLE_DEFS: Record<XlsxStyle, StyleDef> = {
  default: { font: { sz: 10, color: NAVY } },
  title: { font: { sz: 20, bold: true, color: NAVY } },
  subtitle: { font: { sz: 10, color: GRAY } },
  section: {
    font: { sz: 12, bold: true, color: NAVY },
    fill: SAND,
    border: "bottom",
  },
  header: { font: { sz: 10, bold: true, color: WHITE }, fill: NAVY, align: "left" },
  headerRight: { font: { sz: 10, bold: true, color: WHITE }, fill: NAVY, align: "right" },
  text: body(false),
  textAlt: body(true),
  muted: body(false, { font: { sz: 10, color: GRAY } }),
  mutedAlt: body(true, { font: { sz: 10, color: GRAY } }),
  money: body(false, { numFmt: FMT_MONEY, align: "right" }),
  moneyAlt: body(true, { numFmt: FMT_MONEY, align: "right" }),
  int: body(false, { numFmt: FMT_INT, align: "right" }),
  intAlt: body(true, { numFmt: FMT_INT, align: "right" }),
  date: body(false, { numFmt: FMT_DATE, align: "left" }),
  dateAlt: body(true, { numFmt: FMT_DATE, align: "left" }),
  pct: body(false, { numFmt: FMT_PCT, align: "right" }),
  pctAlt: body(true, { numFmt: FMT_PCT, align: "right" }),
  totalLabel: { font: { sz: 10, bold: true, color: NAVY }, fill: SAND, border: "top" },
  totalMoney: {
    font: { sz: 10, bold: true, color: NAVY },
    fill: SAND,
    border: "top",
    numFmt: FMT_MONEY,
    align: "right",
  },
  totalInt: {
    font: { sz: 10, bold: true, color: NAVY },
    fill: SAND,
    border: "top",
    numFmt: FMT_INT,
    align: "right",
  },
  totalPct: {
    font: { sz: 10, bold: true, color: NAVY },
    fill: SAND,
    border: "top",
    numFmt: FMT_PCT,
    align: "right",
  },

  kpiLabel: { font: { sz: 9, color: STONE }, fill: IVORY },
  kpiValue: {
    font: { sz: 16, bold: true, color: NAVY },
    fill: IVORY,
    numFmt: FMT_MONEY,
    align: "left",
  },
  kpiInt: {
    font: { sz: 16, bold: true, color: NAVY },
    fill: IVORY,
    numFmt: FMT_INT,
    align: "left",
  },
  note: { font: { sz: 9, italic: true, color: GRAY }, wrap: true },
};

const STYLE_KEYS = Object.keys(STYLE_DEFS) as XlsxStyle[];

function esc(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Caracteres de control no válidos en XML
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

function stylesXml(): string {
  const fonts: string[] = [];
  const fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  const borders = [
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${LINE}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top style="medium"><color rgb="${NAVY}"/></top><bottom/><diagonal/></border>`,
  ];
  const xfs: string[] = [];
  const fontIndex = new Map<string, number>();
  const fillIndex = new Map<string, number>();

  for (const key of STYLE_KEYS) {
    const d = STYLE_DEFS[key];
    const fKey = JSON.stringify(d.font);
    if (!fontIndex.has(fKey)) {
      fontIndex.set(fKey, fonts.length);
      fonts.push(
        `<font>${d.font.bold ? "<b/>" : ""}${d.font.italic ? "<i/>" : ""}<sz val="${d.font.sz}"/><color rgb="${d.font.color}"/><name val="Calibri"/><family val="2"/></font>`,
      );
    }
    let fillId = 0;
    if (d.fill) {
      if (!fillIndex.has(d.fill)) {
        fillIndex.set(d.fill, fills.length);
        fills.push(
          `<fill><patternFill patternType="solid"><fgColor rgb="${d.fill}"/><bgColor indexed="64"/></patternFill></fill>`,
        );
      }
      fillId = fillIndex.get(d.fill)!;
    }
    const borderId = d.border === "bottom" ? 1 : d.border === "top" ? 2 : 0;
    const numFmt = d.numFmt ?? 0;
    const align =
      d.align || d.wrap
        ? `<alignment vertical="center"${d.align ? ` horizontal="${d.align}"` : ""}${d.wrap ? ' wrapText="1"' : ""}/>`
        : '<alignment vertical="center"/>';
    xfs.push(
      `<xf numFmtId="${numFmt}" fontId="${fontIndex.get(fKey)}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">${align}</xf>`,
    );
  }

  const numFmts = Object.entries(NUM_FMTS)
    .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`)
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${Object.keys(NUM_FMTS).length}">${numFmts}</numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    `<borders count="${borders.length}">${borders.join("")}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

export function colName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Fecha → número de serie de Excel (en hora local, como la ve el estudio). */
export function excelSerial(d: Date): number {
  const utc = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
  return utc / 86400000 + 25569;
}

function sheetXml(sheet: XlsxSheet, hasDrawing: boolean): string {
  const styleId = (s: XlsxStyle | undefined) => STYLE_KEYS.indexOf(s ?? "default");
  const rows = sheet.rows
    .map((row, r) => {
      const height = sheet.rowHeights?.[r];
      const cells = row
        .map((cell, c) => {
          if (!cell) return "";
          const ref = `${colName(c)}${r + 1}`;
          const s = styleId(cell.s);
          const v = cell.v;
          if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${s}"/>`;
          if (v instanceof Date) return `<c r="${ref}" s="${s}"><v>${excelSerial(v)}</v></c>`;
          if (typeof v === "number") {
            return Number.isFinite(v)
              ? `<c r="${ref}" s="${s}"><v>${v}</v></c>`
              : `<c r="${ref}" s="${s}"/>`;
          }
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");

  const cols = sheet.cols?.length
    ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const freeze = sheet.freeze
    ? (() => {
        const ySplit = sheet.freeze!.rows;
        const xSplit = sheet.freeze!.cols ?? 0;
        const topLeft = `${colName(xSplit)}${ySplit + 1}`;
        return `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane${xSplit ? ` xSplit="${xSplit}"` : ""} ySplit="${ySplit}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
      })()
    : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : "";
  const tab = `<sheetPr>${sheet.tabColor ? `<tabColor rgb="${sheet.tabColor}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    tab +
    freeze +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    filter +
    merges +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    (hasDrawing ? '<drawing r:id="rId1"/>' : "") +
    "</worksheet>"
  );
}

function drawingXml(img: XlsxImage): string {
  const EMU = 9525;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${img.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${img.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${img.widthPx * EMU}" cy="${img.heightPx * EMU}"/>` +
    '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
    '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${img.widthPx * EMU}" cy="${img.heightPx * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    "</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>"
  );
}

// --- ZIP (método "store", sin compresión) ----------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    chunks.push(local, f.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Construye el archivo .xlsx completo. */
export function buildXlsx(
  sheets: XlsxSheet[],
  meta: { title: string; author?: string },
): Uint8Array {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, xml: string) => files.push({ name, data: enc.encode(xml) });

  const hasImage = sheets.some((s) => s.image);
  add(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (hasImage ? '<Default Extension="png" ContentType="image/png"/>' : "") +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      sheets
        .map((s, i) =>
          s.image
            ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
            : "",
        )
        .join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>",
  );
  add(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>",
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  add(
    "docProps/core.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.author ?? "Läätu Wellness")}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      "</cp:coreProperties>",
  );
  add(
    "docProps/app.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Läätu Wellness</Application></Properties>',
  );
  add(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<bookViews><workbookView/></bookViews><sheets>" +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("") +
      "</sheets>" +
      (sheets.some((s) => s.autoFilter)
        ? `<definedNames>${sheets
            .map((s, i) =>
              s.autoFilter
                ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.slice(0, 31)).replace(/'/g, "''")}'!${s.autoFilter
                    .split(":")
                    .map((ref) => ref.replace(/([A-Z]+)(\d+)/, "$$$1$$$2"))
                    .join(":")}</definedName>`
                : "",
            )
            .join("")}</definedNames>`
        : "") +
      "</workbook>",
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>",
  );
  add("xl/styles.xml", stylesXml());

  sheets.forEach((s, i) => {
    add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, Boolean(s.image)));
    if (s.image) {
      add(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/>` +
          "</Relationships>",
      );
      add(`xl/drawings/drawing${i + 1}.xml`, drawingXml(s.image));
      add(
        `xl/drawings/_rels/drawing${i + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.png"/>` +
          "</Relationships>",
      );
      files.push({ name: `xl/media/image${i + 1}.png`, data: s.image.data });
    }
  });

  return zipStore(files);
}

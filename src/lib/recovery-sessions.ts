import { creditKindOf, type CreditKind } from "@/lib/credit-kinds";

export type RecoverySession = {
  booking_id: string;
  starts_at: string;
  client_name: string;
  client_email: string;
  credit_kind: string;
  status: string;
  checked_in: boolean;
  price_cents: number;
  class_type: string | null;
};

export type RecoverySummary = {
  total: number;
  totalCents: number;
  byKind: Record<CreditKind, { count: number; cents: number }>;
  byDay: { day: string; sessions: RecoverySession[]; cents: number }[];
};

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** Cuenta las consultas por tipo y por día, con lo que vale cada una. */
export function summarizeSessions(rows: RecoverySession[]): RecoverySummary {
  const byKind: RecoverySummary["byKind"] = {
    general: { count: 0, cents: 0 },
    doris_ul: { count: 0, cents: 0 },
    doris_fb: { count: 0, cents: 0 },
  };
  const days = new Map<string, RecoverySession[]>();
  let totalCents = 0;
  for (const r of rows) {
    const k = creditKindOf(r.credit_kind);
    byKind[k].count += 1;
    byKind[k].cents += r.price_cents;
    totalCents += r.price_cents;
    const d = dayKey(r.starts_at);
    days.set(d, [...(days.get(d) ?? []), r]);
  }
  const byDay = Array.from(days.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, sessions]) => ({
      day,
      sessions,
      cents: sessions.reduce((s, x) => s + x.price_cents, 0),
    }));
  return { total: rows.length, totalCents, byKind, byDay };
}

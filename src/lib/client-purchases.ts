export type ClientPurchase = { planId: string; name: string; count: number };
type PurchaseRow = {
  user_id: string;
  plan_id: string | null;
  status: string;
  token_plans: { name: string } | null;
};

export function groupClientPurchases(rows: PurchaseRow[]): Map<string, ClientPurchase[]> {
  const grouped = new Map<string, ClientPurchase[]>();
  for (const row of rows) {
    if (row.status !== "completed" || !row.plan_id || !row.token_plans) continue;
    const purchases = grouped.get(row.user_id) ?? [];
    const existing = purchases.find((p) => p.planId === row.plan_id);
    if (existing) existing.count += 1;
    else purchases.push({ planId: row.plan_id, name: row.token_plans.name, count: 1 });
    grouped.set(row.user_id, purchases);
  }
  return grouped;
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function matchesClientPurchaseFilter(
  client: {
    full_name: string;
    email: string;
    purchases: ClientPurchase[];
  },
  search: string,
  planId: string,
): boolean {
  if (planId !== "all" && !client.purchases.some((p) => p.planId === planId)) return false;
  const query = normalize(search);
  return (
    !query ||
    [client.full_name, client.email, ...client.purchases.map((p) => p.name)].some((value) =>
      normalize(value).includes(query),
    )
  );
}

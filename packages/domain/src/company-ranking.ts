/**
 * Picker ranking for the two PO party selects (INS-055 / INS-087).
 *
 * Spec §0 P3 replaced `canBeClient`/`canBeFactory` flags with "rank by how
 * often the company already played that role" — but the API flattens `_count`
 * across both edges, so per-role ranking is not yet possible (INS-087). Until
 * it is, rank by overall PO activity, then name. This is THE one place to
 * change when per-role counts land; ranking is a hint and every company stays
 * selectable in either slot.
 */
export function rankCompaniesByActivity<
  T extends { name: string; _count?: { purchaseOrders?: number } },
>(companies: readonly T[]): T[] {
  return [...companies].sort(
    (a, b) =>
      (b._count?.purchaseOrders ?? 0) - (a._count?.purchaseOrders ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

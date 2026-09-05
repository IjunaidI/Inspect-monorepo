/**
 * Picker ranking for the two PO party selects (INS-055 / INS-087).
 *
 * Spec §0 P3 replaced `canBeClient`/`canBeFactory` flags with "rank by how
 * often the company already played that role". INS-087 delivers that: when a
 * `role` is given and the row carries the API's per-role `roleCounts`, rank by
 * that role's count; otherwise (no role, or a row without `roleCounts`) rank
 * by overall PO activity exactly as before. Name is always the final tiebreak.
 *
 * Ranking is a hint — every company stays selectable in either slot.
 */
export type CompanyTradeRole = 'client' | 'factory';

export interface RankableCompany {
  name: string;
  _count?: { purchaseOrders?: number };
  roleCounts?: { asClient: number; asFactory: number };
}

function activityScore(row: RankableCompany, role?: CompanyTradeRole): number {
  if (role && row.roleCounts) {
    return role === 'client'
      ? row.roleCounts.asClient
      : row.roleCounts.asFactory;
  }
  return row._count?.purchaseOrders ?? 0;
}

export function rankCompaniesByActivity<T extends RankableCompany>(
  companies: readonly T[],
  role?: CompanyTradeRole,
): T[] {
  return [...companies].sort(
    (a, b) =>
      activityScore(b, role) - activityScore(a, role) ||
      a.name.localeCompare(b.name),
  );
}

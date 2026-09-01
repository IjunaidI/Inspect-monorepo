/**
 * Display derivations for the signed-report surfaces, shared by the console
 * and the mobile app. These translate server facts for humans — none of them
 * ever computes a verdict (the AQL engine is server-side and its output is
 * what gets signed).
 */

export type ReportConclusion = 'pass' | 'fail' | 'hold' | 'pending';

/**
 * QA decision → report conclusion. No decision recorded yet means `pending` —
 * never fabricate a verdict (INS-056).
 */
export function conclusionFrom(decision?: string | null): ReportConclusion {
  if (decision === 'PASS') return 'pass';
  if (decision === 'FAIL') return 'fail';
  if (decision === 'HOLD') return 'hold';
  return 'pending';
}

/** Prisma enum → readable label: PRE_SHIPMENT → "Pre shipment". */
export function formatInspectionType(type?: string | null): string {
  if (!type) return '—';
  const words = type.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Factory GPS is a JSON column — render "lat, lng" only when both keys exist. */
export function formatGps(gps: unknown): string | null {
  if (gps && typeof gps === 'object' && 'lat' in gps && 'lng' in gps) {
    const { lat, lng } = gps as { lat: unknown; lng: unknown };
    return `${lat}, ${lng}`;
  }
  return null;
}

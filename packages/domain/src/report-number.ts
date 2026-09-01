/**
 * Human-facing display id for a signed report: `IR-` + the first 8 chars of
 * the row id, uppercased. Derived, never stored — the row id stays the only
 * identity. Shown on the console reports list, the branded report, the guest
 * portal and the mobile app, so it lives here once.
 */
export function reportNumber(reportId: string): string {
  return `IR-${reportId.slice(0, 8).toUpperCase()}`;
}

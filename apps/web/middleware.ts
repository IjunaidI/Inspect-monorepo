import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * Role-aware routing (INS-079). An un-assumed Platform Admin has no working
 * org screen — every one runs through requireOrgId and would 403 — so send it
 * to /admin/orgs. Doing this here (rather than per page) covers post-login
 * landing, typed URLs and stale bookmarks with one rule.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = (req.auth as unknown as { role?: string } | null)?.role;
  if (!role) return NextResponse.next();

  const isAdminRoute = pathname.startsWith('/admin');
  const isPlatformAdmin = role === 'PLATFORM_ADMIN';

  if (!isPlatformAdmin && isAdminRoute) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl));
  }

  if (isPlatformAdmin && !isAdminRoute) {
    const assuming = Boolean(req.cookies.get('inspect_admin_org')?.value);
    const isConsoleRoute = ['/dashboard', '/inspections', '/reports', '/presets', '/products', '/purchase-orders', '/users', '/companies']
      .some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!assuming && isConsoleRoute) {
      return NextResponse.redirect(new URL('/admin/orgs', req.nextUrl));
    }
  }

  return NextResponse.next();
});

// Don't invoke Middleware on some paths
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
};

import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * Public proxy for GET /guest/reports/:id/pdf (token-validated by the API
 * itself). The API answers with a short-lived presigned GET URL — it never
 * streams bytes — so this handler 302-redirects the guest's browser straight
 * to storage. Keeps the API base URL server-side, like the sibling report
 * detail proxy, and forwards the real client identity so the API's
 * ReportAccess DOWNLOAD row records the guest rather than this server.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ message: 'token is required' }, { status: 400 });
  }
  try {
    const forwardedFor =
      req.headers.get('x-forwarded-for') ??
      (req as unknown as { ip?: string }).ip ??
      '';
    const res = await fetch(
      `${API_URL}/guest/reports/${encodeURIComponent(id)}/pdf?token=${encodeURIComponent(token)}`,
      {
        cache: 'no-store',
        headers: {
          ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
          'user-agent': req.headers.get('user-agent') ?? 'inspect-portal',
        },
      },
    );
    const body = (await res.json().catch(() => ({}))) as { url?: string };
    if (!res.ok || typeof body.url !== 'string') {
      return NextResponse.json(body, { status: res.ok ? 502 : res.status });
    }
    return NextResponse.redirect(body.url, 302);
  } catch {
    return NextResponse.json({ message: 'Upstream API unreachable' }, { status: 502 });
  }
}

import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * Public proxy for GET /guest/reports/:id (token-validated by the API itself).
 * Keeps the API base URL server-side; the portal client fetches the report
 * detail (incl. INS-049 photo viewUrls) through this handler on selection —
 * so the API's ReportAccess VIEW log fires exactly when a guest views.
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
    const res = await fetch(
      `${API_URL}/guest/reports/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Upstream API unreachable' }, { status: 502 });
  }
}

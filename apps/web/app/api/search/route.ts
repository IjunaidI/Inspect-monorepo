import { NextResponse, type NextRequest } from 'next/server';
import { apiToken } from '@/lib/api';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * Session-authenticated proxy for GET /search (INS-051). The command palette
 * (a client component) calls this handler; the API JWT stays server-side —
 * mirroring the lib/api.ts pattern of never shipping the bearer token to the
 * browser.
 */
export async function GET(req: NextRequest) {
  const token = await apiToken();
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json([]);
  try {
    const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => []);
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Upstream API unreachable' }, { status: 502 });
  }
}

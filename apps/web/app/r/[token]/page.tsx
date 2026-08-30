import { apiGetPublic, type ApiVerifyResult } from '@/lib/api';

function CheckIcon({ ok }: { ok: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 999, background: ok ? '#1F8A4C' : '#B42318', flexShrink: 0 }}>
      {ok ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
      )}
    </span>
  );
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let result: ApiVerifyResult | null = null;
  let unreachable = false;
  try {
    result = await apiGetPublic<ApiVerifyResult>(`/reports/verify/${encodeURIComponent(token)}`);
  } catch (e) {
    // apiGetPublic throws ApiError on a non-2xx response; a network
    // failure surfaces as fetch's TypeError — distinct from "not found".
    unreachable = e instanceof TypeError;
  }

  const allGood = result?.valid && result?.hashMatches && result?.signatureValid;
  const mainColor = allGood ? '#1F8A4C' : '#B42318';
  const mainBg = allGood ? '#EAF6F0' : '#FEF2F0';
  const mainBorder = allGood ? '#BEE3CD' : '#F1C9C5';

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1F5', display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <header style={{ height: 56, background: '#fff', borderBottom: '1px solid #E4E7EE', display: 'flex', alignItems: 'center', padding: '0 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#037BF4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#fff', letterSpacing: -0.5 }}>I</div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0B1220' }}>Report Verification</span>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8A95A3' }}>Powered by Inspect</span>
      </header>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          {!result ? (
            /* Error state */
            <div style={{ background: '#fff', border: '1px solid #F1C9C5', borderRadius: 12, padding: '32px 28px', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: '#FEF2F0', border: '2px solid #F1C9C5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6l-12 12" stroke="#B42318" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#B42318' }}>
                {unreachable ? 'Could not reach the verification service' : 'Token not found or expired'}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: '#8A95A3', lineHeight: 1.5 }}>
                {unreachable
                  ? 'The verification service did not respond. Please try again shortly.'
                  : 'The verification token is invalid or no longer available.'}
              </div>
            </div>
          ) : (
            /* Verification result */
            <div style={{ background: '#fff', border: `1px solid ${mainBorder}`, borderRadius: 12, overflow: 'hidden' }}>
              {/* Badge */}
              <div style={{ background: mainBg, padding: '28px 28px 24px', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: 999, background: mainColor, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                  {allGood ? (
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M6 16l7 7 13-13" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M8 8l16 16M24 8l-16 16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
                  )}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: mainColor }}>
                  {allGood ? 'Report verified' : 'Verification failed'}
                </div>
                <div style={{ fontSize: 13, color: '#8A95A3', marginTop: 4 }}>
                  {allGood ? 'This report is authentic and unmodified.' : 'One or more checks failed. This report may have been altered.'}
                </div>
              </div>

              {/* Sub-checks */}
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, borderBottom: '1px solid #E4E7EE' }}>
                {[
                  ['Record found', result.valid],
                  ['Content hash matches', result.hashMatches],
                  ['Signature valid (Ed25519)', result.signatureValid],
                ] .map(([label, ok]) => (
                  <div key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CheckIcon ok={Boolean(ok)} />
                    <span style={{ fontSize: 13, color: '#0B1220', fontWeight: 500 }}>{String(label)}</span>
                  </div>
                ))}
              </div>

              {/* Provenance */}
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#8A95A3', textTransform: 'uppercase', letterSpacing: 0.5 }}>Provenance</div>
                {[
                  ['Report ID', result.reportId],
                  ['Inspection ID', result.inspectionId],
                  ['Generated at', result.generatedAt ? new Date(result.generatedAt).toLocaleString() : null],
                ].map(([k, v]) => (
                  <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12.5 }}>
                    <span style={{ color: '#8A95A3' }}>{String(k)}</span>
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#0B1220', textAlign: 'right', wordBreak: 'break-all' }}>{v ?? '—'}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#8A95A3', lineHeight: 1.5 }}>
                  This verifies the signed JSON record — the canonical, tamper-evident form of this report. The PDF is a rendering of it.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

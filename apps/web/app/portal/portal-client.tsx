'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, ExternalLink, Lock, Search } from 'lucide-react';
import { Mono } from '@/components/inspect/shell';
import { BrandedReport, type BrandedReportData } from '@/components/inspect/branded-report';
import { severity, ui } from '@/components/inspect/tokens';
import { readCanonicalParties } from '@inspect/shared-types';
import type { ApiGuestReport, ApiGuestReportPhoto } from '@/lib/api';

type PortalStatus = 'pass' | 'fail' | 'hold';
const statusChip: Record<PortalStatus, { label: string; fg: string; bg: string }> = {
  pass: { label: 'Accepted', fg: '#1F6B43', bg: '#EAF6F0' },
  fail: { label: 'Rejected', fg: severity.critical.fg, bg: severity.critical.bg },
  hold: { label: 'On hold', fg: severity.major.fg, bg: severity.major.bg },
};

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

function reportStatus(r: ApiGuestReport): PortalStatus {
  const snap = r.canonicalSnapshot as { aqlResult?: { qaDecision?: string } } | null;
  const d = snap?.aqlResult?.qaDecision?.toLowerCase();
  return d === 'pass' ? 'pass' : d === 'fail' ? 'fail' : 'hold';
}

function mapToReportData(
  r: ApiGuestReport,
  client: { name: string; color: string },
  photos?: ApiGuestReportPhoto[],
): BrandedReportData {
  type Snap = {
    poNumber?: string | null;
    lotSize?: number | null;
    product?: { styleNumber?: string | null; description?: string | null } | null;

    aqlResult?: {
      qaDecision?: string | null;
      qaRemarks?: string | null;
      perClass?: Record<string, { found?: number; ac?: number; re?: number }>;
    } | null;
    computedSampling?: {
      sampleSize?: number | null;
      sampleSizeCodeLetter?: string | null;
      perClass?: Record<string, { aql?: number; ac?: number; re?: number }>;
    } | null;
    tamperProof?: string | null;
  };
  const snap = (r.canonicalSnapshot ?? {}) as Snap;
  const aqlResult = snap.aqlResult;
  const cs = snap.computedSampling;
  // INS-055 spec §5.5: party identity comes from the shared reader, which knows
  // both canonical versions. This component must not destructure `buyer` or
  // `client` itself — a v1 and a v2 report have to render identically, forever.
  const parties = readCanonicalParties(r.canonicalSnapshot);

  const classes: BrandedReportData['classes'] = (['critical', 'major', 'minor'] as const).map((sev) => ({
    sev,
    aql: cs?.perClass?.[sev]?.aql ?? 0,
    found: aqlResult?.perClass?.[sev]?.found ?? 0,
    ac: cs?.perClass?.[sev]?.ac ?? aqlResult?.perClass?.[sev]?.ac ?? 0,
    re: cs?.perClass?.[sev]?.re ?? aqlResult?.perClass?.[sev]?.re ?? 0,
  }));

  const decisionRaw = aqlResult?.qaDecision?.toLowerCase();
  const conclusion: 'pass' | 'fail' | 'hold' =
    decisionRaw === 'pass' ? 'pass' : decisionRaw === 'fail' ? 'fail' : 'hold';

  return {
    client: { name: client.name, initials: initialsOf(client.name), color: client.color },
    meta: {
      // Synthetic display id — no reportNo column exists (documented as synthetic).
      reportNo: `IR-${r.id.slice(0, 8).toUpperCase()}`,
      po: snap.poNumber ?? '—',
      product: snap.product?.styleNumber ?? snap.product?.description ?? '—',
      factory: parties.factory?.name ?? '—',
      type: 'Pre-shipment',
      date: r.generatedAt.split('T')[0],
    },
    conclusion,
    qaRemarks: aqlResult?.qaRemarks ?? null,
    samplingPlan:
      cs?.sampleSize != null
        ? { sampleSize: cs.sampleSize, codeLetter: cs.sampleSizeCodeLetter ?? '—', lotSize: snap.lotSize ?? 0 }
        : null,
    classes,
    // Buyer-visible photo evidence (INS-049) — the guest detail endpoint returns
    // flat photos (no loop names), so they render as a single evidence group.
    photos:
      photos && photos.length > 0
        ? [{ loop: 'Evidence photos', shots: photos.map((p) => ({ id: p.id, viewUrl: p.viewUrl })), flaggedCount: 0 }]
        : undefined,
    tamperProof: r.contentHash
      ? { contentHash: r.contentHash, signedAt: r.generatedAt }
      : null,
  };
}

export function PortalClient({
  token,
  reports,
  client,
}: {
  token: string;
  reports: ApiGuestReport[];
  client: { name: string; color: string };
}) {
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [search, setSearch] = useState('');
  // Photo evidence per report id, fetched lazily from the guest detail endpoint
  // (INS-049) via the server-side proxy route when a report is selected.
  const [photosById, setPhotosById] = useState<Record<string, ApiGuestReportPhoto[]>>({});

  useEffect(() => {
    if (!selectedId || photosById[selectedId]) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/guest/reports/${encodeURIComponent(selectedId)}?token=${encodeURIComponent(token)}`);
        if (!res.ok) return;
        const detail = (await res.json()) as ApiGuestReport;
        if (!cancelled) {
          setPhotosById((prev) => ({ ...prev, [selectedId]: detail.photos ?? [] }));
        }
      } catch {
        // Photos are progressive enhancement — the report renders without them.
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, token, photosById]);

  const C = client.color;
  const initials = initialsOf(client.name);

  const filtered = reports.filter((r) => {
    const snap = r.canonicalSnapshot as { poNumber?: string } | null;
    const q = search.toLowerCase();
    return (snap?.poNumber ?? '').toLowerCase().includes(q) || r.id.includes(q);
  });

  const selected = reports.find((r) => r.id === selectedId);
  const selectedStatus = selected ? reportStatus(selected) : 'hold';
  const selectedChip = statusChip[selectedStatus];
  const reportData = selected ? mapToReportData(selected, client, photosById[selected.id]) : null;

  return (
    <div style={{ height: '100vh', background: '#EEF1F5', fontFamily: ui.font, fontSize: 13, color: ui.ink, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ height: 60, background: C, display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.16)', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
            {initials}
          </div>
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{client.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Inspection reports</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500, background: 'rgba(255,255,255,0.16)', color: '#fff' }}>
            <Eye size={13} color="#fff" /> Guest · read-only
          </span>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 360, background: '#fff', borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: ui.line, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '20px 20px 14px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: ui.line }}>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Your reports</div>
            <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 2 }}>Showing reports for {client.name} only</div>
            <div style={{ position: 'relative', marginTop: 14 }}>
              <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', height: 36, padding: '0 12px 0 36px', fontSize: 13, background: ui.bg, border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                placeholder="Search by PO…"
              />
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '32px 0', textAlign: 'center', color: ui.faint, fontSize: 13 }}>
                {reports.length === 0 ? 'No reports yet.' : 'No reports match your search.'}
              </div>
            )}
            {filtered.map((r) => {
              const st = reportStatus(r);
              const sc = statusChip[st];
              const snap = r.canonicalSnapshot as { poNumber?: string } | null;
              const isActive = r.id === selectedId;
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  style={{ padding: 14, borderRadius: 10, marginBottom: 8, cursor: 'pointer', background: isActive ? ui.accentSoft : '#fff', border: `1px solid ${isActive ? '#CFE5FD' : ui.line}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mono style={{ fontSize: 12, fontWeight: 600 }}>{snap?.poNumber ?? r.id.slice(0, 8)}</Mono>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: sc.bg, color: sc.fg }}>
                      {sc.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 6 }}>
                    <Mono>{r.generatedAt.split('T')[0]}</Mono>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '12px 16px', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: ui.line, fontSize: 11, color: ui.faint, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} color={ui.faint} /> Read-only access · {reports.length} report{reports.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {selected && reportData ? (
            <>
              <div style={{ height: 52, background: '#fff', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: ui.line, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12, flexShrink: 0 }}>
                <Mono style={{ fontSize: 12.5, fontWeight: 600 }}>{reportData.meta.reportNo}</Mono>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: selectedChip.bg, color: selectedChip.fg }}>
                  {selectedChip.label}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selected.verificationToken && (
                    <a
                      href={`/r/${selected.verificationToken}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 500, border: `1px solid ${ui.line}`, background: '#fff', color: ui.sub, textDecoration: 'none' }}
                    >
                      <ExternalLink size={13} /> Verify
                    </a>
                  )}
                  {selected.pdfStorageKey ? (
                    <a
                      href={`/api/reports/${selected.id}/pdf?token=${token}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 550, border: `1px solid ${ui.line}`, background: '#fff', color: ui.ink, textDecoration: 'none' }}
                    >
                      <Download size={14} /> Download PDF
                    </a>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 500, border: `1px solid ${ui.lineSoft}`, background: ui.fill, color: ui.faint }}>
                      <Download size={14} /> PDF pending
                    </span>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 28, display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 760, maxWidth: '100%', boxShadow: '0 4px 24px rgba(11,18,32,0.12)', borderRadius: 8, overflow: 'hidden', height: 'fit-content', flexShrink: 0 }}>
                  <BrandedReport data={reportData} width="100%" />
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, fontSize: 13 }}>
              Select a report from the list
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

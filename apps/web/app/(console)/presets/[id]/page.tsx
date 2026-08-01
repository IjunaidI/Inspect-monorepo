import { notFound } from 'next/navigation';
import { Copy } from 'lucide-react';
import { apiGet, type ApiLoopPresetDetail } from '@/lib/api';
import { Btn, Mono, PageHead, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';

export const dynamic = 'force-dynamic';

const sevMap: Record<string, SeverityKey> = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
};

export default async function PresetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let preset: ApiLoopPresetDetail;
  try {
    preset = await apiGet<ApiLoopPresetDetail>(`/loop-presets/${id}`);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title={`${preset.name} · v${preset.version}`}
        sub={[preset.description, preset.aqlLevel ? `AQL ${preset.aqlLevel}` : null].filter(Boolean).join(' · ') || 'Loop preset'}
        actions={
          /*
           * INS-076: presets are never edited in place — the API is
           * GET/POST/DELETE only. This opens a pre-seeded builder, so the
           * honest label is "Duplicate" (same label as the list card menu).
           * The builder itself states which version the save lands on.
           */
          <Btn kind="primary" icon={<Copy size={15} />} href={`/presets/new?from=${preset.id}`}>
            Duplicate
          </Btn>
        }
      />

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {preset.steps.map((step, i) => (
          <div
            key={step.id}
            style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 20 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 24 }}>
                {String(i + 1).padStart(2, '0')}
              </Mono>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{step.zoneName}</div>
              <Mono style={{ marginLeft: 'auto', fontSize: 11.5, color: ui.sub }}>
                {step.requiredShotCount} shot{step.requiredShotCount !== 1 ? 's' : ''}
              </Mono>
            </div>

            {step.description && (
              <div style={{ fontSize: 13, color: ui.sub, marginBottom: 14 }}>{step.description}</div>
            )}

            {/* Reference images (INS-052): thumbnails via short-lived presigned GETs. */}
            {(step.referenceImages ?? []).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Reference images
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(step.referenceImages ?? []).map((img) =>
                    img.viewUrl ? (
                      <a key={img.key} href={img.viewUrl} target="_blank" rel="noreferrer" title="Open full size">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.viewUrl}
                          alt=""
                          loading="lazy"
                          style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: `1px solid ${ui.line}`, display: 'block' }}
                        />
                      </a>
                    ) : (
                      <div
                        key={img.key}
                        title={img.key}
                        style={{ width: 96, height: 96, borderRadius: 8, border: `1px solid ${ui.line}`, background: 'repeating-linear-gradient(135deg, #FAFBFC 0 8px, #F0F3F7 8px 16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, color: ui.faint }}
                      >
                        unavailable
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            {step.allowedDefects.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Defect tags
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {step.allowedDefects.map((ad) => {
                    const sk = sevMap[ad.defectCatalog.defaultSeverity] ?? 'minor';
                    const s = severity[sk];
                    return (
                      <span
                        key={ad.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: s.bg, color: s.fg }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: 999, background: s.dot }} />
                        {ad.defectCatalog.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {step.measurementFields.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Measurement fields
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {step.measurementFields.map((f) => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <SeverityTag sev="minor" />
                      <span>{f.label}</span>
                      {f.unit && <Mono style={{ fontSize: 11.5, color: ui.faint }}>{f.unit}</Mono>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step.allowedDefects.length === 0 && step.measurementFields.length === 0 && (
              <div style={{ fontSize: 13, color: ui.faint }}>No defect tags or measurement fields configured.</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <Btn kind="ghost" href="/presets">← Back to presets</Btn>
      </div>
    </div>
  );
}

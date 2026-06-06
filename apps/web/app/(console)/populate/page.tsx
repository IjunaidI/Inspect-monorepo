import type { CSSProperties } from 'react';
import { Check, ChevronRight, ClipboardList, Eye, Lock, MoreVertical, Plus, Upload } from 'lucide-react';
import { Btn, Mono, RoleBadge, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';

const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 };

const popLoops = [
  { name: 'Fabric inspection', req: 4, filled: 4, done: true, active: false },
  { name: 'Stitching & seams', req: 6, filled: 6, done: true, active: false },
  { name: 'Collar & neckline', req: 5, filled: 3, done: false, active: true },
  { name: 'Sleeves & cuffs', req: 4, filled: 0, done: false, active: false },
  { name: 'Buttons & buttonholes', req: 5, filled: 0, done: false, active: false },
  { name: 'Final pack inspection', req: 4, filled: 0, done: false, active: false },
];

const collarSlots = [
  { name: 'Collar front — flat', filled: true, grad: '#C8D0DA,#8C95A3', flagged: false },
  { name: 'Collar back — flat', filled: true, grad: '#D2C9BE,#9A8E7E', flagged: false },
  { name: 'Neckline ring — top', filled: true, grad: '#BFC8D2,#7E8794', flagged: true },
  { name: 'Stitch density (4×4 cm)', filled: false, grad: '', flagged: false },
  { name: 'Label placement — inside', filled: false, grad: '', flagged: false },
];

const collarTags: Record<SeverityKey, { d: string; on: boolean }[]> = {
  critical: [],
  major: [{ d: 'Skewed collar', on: true }, { d: 'Misaligned label', on: false }, { d: 'Open seam', on: false }, { d: 'Puckering', on: false }],
  minor: [{ d: 'Uneven point', on: true }, { d: 'Loose thread', on: false }, { d: 'Slight shade variation', on: false }],
};

function CompactUnverified() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: severity.major.bg, color: severity.major.fg }}>
      <Upload size={10} /> Unverified
    </span>
  );
}

export default function PopulatePage() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ height: 56, borderBottom: `1px solid ${ui.line}`, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13 }}>
          <ClipboardList size={15} color={ui.sub} /><span>Inspections</span>
          <ChevronRight size={14} color={ui.faint} />
          <Mono style={{ color: ui.ink, fontWeight: 600 }}>PO-2026-04812</Mono>
          <ChevronRight size={14} color={ui.faint} />
          <span style={{ color: ui.ink, fontWeight: 550 }}>Populate</span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: ui.accentSoft, color: ui.accent }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: ui.accent }} /> Populating
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: ui.faint }}>
            <Lock size={13} color={ui.faint} /> Upload limited to <RoleBadge role="platform" />
          </span>
          <Btn kind="ghost">Save</Btn>
          <Btn kind="primary" icon={<Check size={15} />}>Submit for review</Btn>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 300, background: '#fff', borderRight: `1px solid ${ui.line}`, padding: '20px 16px', overflow: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Standard Knit Shirt</div>
          <div style={{ fontSize: 12, color: ui.sub, marginTop: 3 }}>Nordvik Retail Group · Polo · <Mono>NV-KP-2241</Mono></div>

          <div style={{ marginTop: 16, padding: 12, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: ui.sub }}>Photos uploaded</span>
              <span><Mono style={{ fontWeight: 600 }}>13</Mono><span style={{ color: ui.faint }}> / </span><Mono>28</Mono></span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: ui.line, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: '46%', height: '100%', background: ui.accent, borderRadius: 999 }} />
            </div>
          </div>

          <div style={{ ...fieldLabel, margin: '18px 0 10px' }}>Loops · {popLoops.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {popLoops.map((l, i) => (
              <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: l.active ? ui.accentSoft : 'transparent', borderLeft: l.active ? `2px solid ${ui.accent}` : '2px solid transparent', marginLeft: l.active ? -2 : 0 }}>
                <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: l.active ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                  <div style={{ fontSize: 11, color: ui.faint, marginTop: 1 }}><Mono>{l.filled}/{l.req}</Mono> photos</div>
                </div>
                {l.done ? (
                  <span style={{ width: 18, height: 18, borderRadius: 999, background: '#1F8A4C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={11} color="#fff" /></span>
                ) : (
                  <span style={{ width: 18, height: 18, borderRadius: 999, border: `1.5px solid ${ui.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: ui.faint }}>{l.filled || ''}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px', minWidth: 0 }}>
          <div style={{ maxWidth: 880 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div>
                <Mono style={{ fontSize: 12, color: ui.sub }}>LOOP 03</Mono>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.2, marginTop: 4 }}>Collar &amp; neckline</div>
                <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 3 }}><Mono>3</Mono> of <Mono>5</Mono> required shots uploaded</div>
              </div>
              <Btn kind="primary" icon={<Upload size={15} />} style={{ marginLeft: 'auto' }}>Upload photos</Btn>
            </div>

            <div style={{ ...fieldLabel, margin: '22px 0 12px' }}>Required shot slots</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {collarSlots.map((s, i) => (
                <div key={s.name} style={{ border: `1px solid ${s.filled ? ui.line : 'transparent'}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
                  <div style={{ position: 'relative', height: 150, background: s.filled ? `linear-gradient(135deg,${s.grad})` : 'repeating-linear-gradient(135deg,#FAFBFC 0 8px,#F0F3F7 8px 16px)', border: s.filled ? 'none' : '1.5px dashed #C8D0DA', borderRadius: s.filled ? 0 : 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {s.filled ? (
                      <>
                        <div style={{ position: 'absolute', top: 8, left: 8 }}><CompactUnverified /></div>
                        {s.flagged && <div style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 999, background: severity.major.dot, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>!</div>}
                        <div style={{ position: 'absolute', bottom: 8, right: 8, width: 26, height: 26, borderRadius: 7, background: 'rgba(11,18,32,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Eye size={14} color="#fff" /></div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', color: ui.faint }}>
                        <Upload size={20} color={ui.faint} />
                        <div style={{ fontSize: 11.5, marginTop: 6 }}>Drop photo</div>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mono style={{ fontSize: 11, color: ui.faint }}>{String(i + 1).padStart(2, '0')}</Mono>
                    <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: s.filled ? ui.ink : ui.faint }}>{s.name}</span>
                    {s.filled && <MoreVertical size={15} color={ui.faint} />}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...fieldLabel, margin: '26px 0 12px' }}>Tag defects for this loop</div>
            <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(['critical', 'major', 'minor'] as SeverityKey[]).map((sev) => {
                const s = severity[sev];
                const tags = collarTags[sev];
                return (
                  <div key={sev}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <SeverityTag sev={sev} />
                      <Mono style={{ fontSize: 11, color: ui.faint }}>{tags.filter((t) => t.on).length} tagged</Mono>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {tags.length === 0 && <span style={{ fontSize: 12, color: ui.faint, fontStyle: 'italic' }}>None available for this loop</span>}
                      {tags.map((t) => (
                        <div key={t.d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: t.on ? s.bg : '#fff', color: t.on ? s.fg : ui.sub, border: `1px solid ${t.on ? s.bg : ui.line}` }}>
                          {t.on ? <Check size={13} color={s.fg} /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />}
                          {t.d}
                        </div>
                      ))}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: '#fff', color: ui.sub, border: `1px dashed ${ui.line}` }}>
                        <Plus size={13} /> Custom
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ ...fieldLabel, margin: '26px 0 12px' }}>Measurements · free-form entry</div>
            <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', padding: '10px 16px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
                <span>Point</span><span style={{ textAlign: 'right' }}>Measured</span><span style={{ textAlign: 'right' }}>Unit</span>
              </div>
              {([['Collar point length', '7.4', 'in'], ['Collar spread', '11.3', 'in'], ['Stitch density', '8', 'spi']] as [string, string, string][]).map((m, i) => (
                <div key={m[0]} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', alignItems: 'center', padding: '11px 16px', borderTop: i ? `1px solid ${ui.lineSoft}` : 'none' }}>
                  <span style={{ fontSize: 13 }}>{m[0]}</span>
                  <input defaultValue={m[1]} style={{ textAlign: 'right', width: 110, justifySelf: 'end', height: 30, padding: '0 10px', fontSize: 12.5, fontFamily: 'var(--font-mono)', background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 6, outline: 'none' }} />
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: ui.sub }}>{m[2]}</Mono>
                </div>
              ))}
              <div style={{ padding: '10px 16px', borderTop: `1px solid ${ui.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5, fontWeight: 500 }}>
                <Plus size={14} /> Add measurement point
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: ui.faint, lineHeight: 1.45 }}>
              Measurements are free-form (label · value · unit) in the MVP — no spec/tolerance or pass-fail per point. Pass/fail is whole-inspection, computed via AQL and decided by a QA Manager.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Repeat,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { Mono, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';

const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 };

const builderLoops = [
  { name: 'Fabric inspection', shots: 4, defects: 6, active: false },
  { name: 'Stitching & seams', shots: 6, defects: 9, active: false },
  { name: 'Collar & neckline', shots: 5, defects: 4, active: true },
  { name: 'Sleeves & cuffs', shots: 4, defects: 5, active: false },
  { name: 'Buttons & buttonholes', shots: 5, defects: 3, active: false },
  { name: 'Final pack inspection', shots: 4, defects: 4, active: false },
];
const collarShots = [
  { name: 'Collar front — flat', overlay: 'Rectangle' },
  { name: 'Collar back — flat', overlay: 'Rectangle' },
  { name: 'Neckline ring — top', overlay: 'Circle' },
  { name: 'Stitch density (4×4 cm)', overlay: 'Grid' },
  { name: 'Label placement — inside', overlay: 'None' },
];
const loopDefects: Record<SeverityKey, string[]> = {
  critical: ['Needle / metal contamination'],
  major: ['Skewed collar', 'Misaligned label', 'Open seam', 'Puckering'],
  minor: ['Uneven point', 'Loose thread', 'Slight shade variation'],
};
// Free-form measurement FIELDS (label + optional unit) per spec §6 — no target/tolerance.
const measurementFields: [string, string][] = [
  ['Collar point length', 'cm'],
  ['Collar spread', 'cm'],
  ['Stitch density', 'spi'],
];

const titleInput: CSSProperties = { fontFamily: 'inherit', border: 'none', background: 'transparent', outline: 'none', color: ui.ink, padding: 0 };
const rowInput: CSSProperties = { flex: 1, fontFamily: 'inherit', border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: ui.ink };
const pill: CSSProperties = { width: 130, height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${ui.line}`, borderRadius: 6, fontSize: 12, color: ui.sub, background: ui.fill };
const iconBtn: CSSProperties = { width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint };

export default function PresetBuilderPage() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ height: 56, borderBottom: `1px solid ${ui.line}`, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13 }}>
          <Repeat size={15} color={ui.sub} /><span>Loop Presets</span>
          <ChevronRight size={14} color={ui.faint} />
          <span style={{ color: ui.ink, fontWeight: 550 }}>Standard Knit Shirt</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: ui.sub }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#1F8A4C' }} /> Saved · 2 min ago
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ui.faint, fontWeight: 500 }}>
            <Smartphone size={14} color={ui.faint} /> Preview on phone (Phase 2)
          </div>
          <button style={{ height: 34, padding: '0 14px', background: 'transparent', color: ui.sub, border: `1px solid ${ui.line}`, borderRadius: 8, fontWeight: 500, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
          <button style={{ height: 34, padding: '0 16px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 550, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>Save Preset</button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 320, background: '#fff', borderRight: `1px solid ${ui.line}`, padding: '24px 20px', display: 'flex', flexDirection: 'column', overflow: 'auto', flexShrink: 0 }}>
          <input defaultValue="Standard Knit Shirt" style={{ ...titleInput, fontSize: 18, fontWeight: 600, marginBottom: 8, letterSpacing: -0.2 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 500, background: '#F1EEFB', color: '#5B45B0' }}>Garments</span>
            <span style={{ fontSize: 11.5, color: ui.faint }}>· v3 · Last edited 2 days ago</span>
          </div>
          <div style={{ fontSize: 12, color: ui.sub, marginTop: 12, lineHeight: 1.5 }}>
            Used by <Mono style={{ color: ui.ink, fontWeight: 600, fontSize: 12 }}>12</Mono> buyers. Editing creates a new version; historical inspections keep their snapshot.
          </div>

          <div style={{ borderTop: `1px solid ${ui.line}`, margin: '20px 0 16px' }} />

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ ...fieldLabel, marginBottom: 0 }}>Loops · {builderLoops.length}</div>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint }}>
              <Mono>{builderLoops.reduce((a, l) => a + l.shots, 0)}</Mono> shots
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {builderLoops.map((l, i) => (
              <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, background: l.active ? ui.accentSoft : 'transparent', borderLeft: l.active ? `2px solid ${ui.accent}` : '2px solid transparent', marginLeft: l.active ? -2 : 0 }}>
                <GripVertical size={14} color={ui.faint} />
                <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: l.active ? 600 : 500, color: ui.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                  <Mono style={{ fontSize: 11, color: ui.faint, marginTop: 1 }}>{l.shots} shots · {l.defects} tags</Mono>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, height: 40, border: '1.5px dashed #C8D0DA', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: ui.sub, fontSize: 12.5, fontWeight: 500 }}>
            <Plus size={14} /> Add Loop
          </div>
        </div>

        <div style={{ flex: 1, padding: '28px 32px', overflow: 'auto', minWidth: 0 }}>
          <div style={{ maxWidth: 760 }}>
            <Mono style={{ fontSize: 12, color: ui.sub }}>LOOP 03</Mono>
            <input defaultValue="Collar & neckline" style={{ ...titleInput, fontSize: 22, fontWeight: 600, width: '100%', letterSpacing: -0.3, marginTop: 8, display: 'block' }} />
            <div style={{ fontSize: 13, color: ui.sub, marginTop: 6 }}>Where the inspector verifies collar geometry, stitching density, and label placement.</div>

            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 28, marginTop: 28 }}>
              <div>
                <div style={fieldLabel}>Reference</div>
                <div style={{ width: 200, height: 200, borderRadius: 10, border: '1.5px dashed #C8D0DA', background: 'repeating-linear-gradient(135deg, #FAFBFC 0 8px, #F0F3F7 8px 16px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: ui.sub }}>
                  <ImageIcon size={20} color={ui.sub} />
                  <Mono style={{ fontSize: 11.5, color: ui.sub }}>collar-zone-diagram.svg</Mono>
                  <div style={{ fontSize: 11, color: ui.faint }}>Drop image or <span style={{ color: ui.accent }}>pick from library</span></div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0 }}>
                <div>
                  <div style={fieldLabel}>Required shots · {collarShots.length}</div>
                  <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
                    {collarShots.map((s, i) => (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: i ? `1px solid ${ui.lineSoft}` : 'none' }}>
                        <GripVertical size={14} color="#C8D0DA" />
                        <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                        <input defaultValue={s.name} style={rowInput} />
                        <div style={pill}><span>{s.overlay}</span><ChevronDown size={12} color={ui.faint} /></div>
                        <div style={iconBtn}><Trash2 size={14} /></div>
                      </div>
                    ))}
                    <div style={{ padding: '10px 12px', borderTop: `1px solid ${ui.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5, fontWeight: 500 }}>
                      <Plus size={14} /> Add Shot
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={fieldLabel}>Defect tags · severity-classified</div>
                    <span style={{ marginLeft: 'auto', marginBottom: 8, fontSize: 11, color: ui.faint }}>From seeded library</span>
                  </div>
                  <div style={{ border: `1px solid ${ui.line}`, borderRadius: 10, background: '#fff', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {(['critical', 'major', 'minor'] as SeverityKey[]).map((sev) => {
                      const s = severity[sev];
                      return (
                        <div key={sev}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <SeverityTag sev={sev} />
                            <Mono style={{ fontSize: 11, color: ui.faint }}>{loopDefects[sev].length}</Mono>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {loopDefects[sev].map((d) => (
                              <div key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 6px 0 10px', background: s.bg, color: s.fg, borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
                                <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
                                {d}
                                <span style={{ width: 18, height: 18, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}><X size={11} /></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${ui.lineSoft}`, paddingTop: 12 }}>
                      <div style={{ flex: 1, height: 34, border: `1px solid ${ui.line}`, borderRadius: 8, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12.5, color: ui.faint }}>Add custom defect tag…</div>
                      <div style={{ height: 34, border: `1px solid ${ui.line}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', fontSize: 12, color: ui.sub, background: ui.fill }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: severity.minor.dot }} /> Minor <ChevronDown size={12} color={ui.faint} />
                      </div>
                      <button style={{ height: 34, padding: '0 14px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 550, fontFamily: 'inherit', cursor: 'pointer' }}>Add</button>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={fieldLabel}>Measurement fields · free-form</div>
                  <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
                    {measurementFields.map(([label, unit], i) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: i ? `1px solid ${ui.lineSoft}` : 'none' }}>
                        <input defaultValue={label} style={rowInput} />
                        <div style={{ width: 90, height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${ui.line}`, borderRadius: 6, fontSize: 12, color: ui.sub, background: ui.fill }}>
                          <Mono>{unit}</Mono><ChevronDown size={11} color={ui.faint} />
                        </div>
                        <div style={iconBtn}><Trash2 size={14} /></div>
                      </div>
                    ))}
                    <div style={{ padding: '10px 12px', borderTop: `1px solid ${ui.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5, fontWeight: 500 }}>
                      <Plus size={14} /> Add measurement field
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 8, lineHeight: 1.45 }}>
                    Fields are labels only (with an optional unit). Values are entered free-form during populate — no target/tolerance in the MVP (spec §9).
                  </div>
                </div>

                <div>
                  <div style={fieldLabel}>Pass / fail</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, background: ui.accentSoft, border: '1px solid #CFE5FD', borderRadius: 10 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 999, background: ui.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'Georgia, serif', flexShrink: 0, marginTop: 1 }}>i</span>
                    <div style={{ fontSize: 12.5, color: '#1457A3', lineHeight: 1.5 }}>
                      <b style={{ fontWeight: 600 }}>Pass / fail is decided at the inspection level.</b> The system flags the result from the AQL plan (defect counts by class vs. Accept / Reject) and a QA Manager makes the binding call. Loops only collect evidence — there are no per-loop verdicts.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

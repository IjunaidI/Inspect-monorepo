import type { CSSProperties } from 'react';
import { Check, ChevronDown, ChevronRight, ClipboardList, Lock, Repeat, Settings } from 'lucide-react';
import { Avatar, Btn, PageHead, RoleBadge } from '@/components/inspect/shell';
import { aqlPlan, mono, severity, ui } from '@/components/inspect/tokens';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const lbl: CSSProperties = { fontSize: 12, fontWeight: 550, color: ui.ink };
const input: CSSProperties = {
  height: 40, padding: '0 12px', fontSize: 13.5, background: '#fff', border: `1px solid ${ui.line}`,
  borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none', boxSizing: 'border-box',
  display: 'flex', alignItems: 'center',
};
const select: CSSProperties = { ...input, justifyContent: 'space-between', cursor: 'pointer' };
const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 };
const card: CSSProperties = { background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22 };

export default function CreateInspectionPage() {
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>New inspection</span>
      </div>
      <PageHead
        title="Create inspection"
        sub="Define the lot. The AQL sampling plan is computed automatically from level and lot size."
        actions={
          <>
            <Btn kind="ghost">Save draft</Btn>
            <Btn kind="primary" icon={<Check size={15} />}>Create &amp; assign</Btn>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, marginTop: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={card}>
            <div style={sectionTitle}>Parties</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <div style={field}>
                <span style={lbl}>Buyer</span>
                <div style={select}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 5, background: '#1457A3', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>NV</span>
                    Nordvik Retail Group
                  </span>
                  <ChevronDown size={15} color={ui.faint} />
                </div>
              </div>
              <div style={field}>
                <span style={lbl}>Supplier / factory</span>
                <div style={select}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Avatar initials="TK" size={22} bg="#475467" /> Tirupur Knits Unit-3
                  </span>
                  <ChevronDown size={15} color={ui.faint} />
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <div style={field}>
                <span style={lbl}>PO number</span>
                <input style={{ ...input, ...mono }} defaultValue="PO-2026-04812" />
              </div>
              <div style={field}>
                <span style={lbl}>Buyer reference <span style={{ color: ui.faint, fontWeight: 400 }}>· optional</span></span>
                <input style={{ ...input, ...mono }} placeholder="REF-…" />
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={sectionTitle}>Product</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginTop: 14 }}>
              <div style={field}>
                <span style={lbl}>Product</span>
                <div style={select}><span>Men&apos;s Knit Polo Shirt</span><ChevronDown size={15} color={ui.faint} /></div>
              </div>
              <div style={field}>
                <span style={lbl}>Style / SKU</span>
                <input style={{ ...input, ...mono }} defaultValue="NV-KP-2241" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 14 }}>
              <div style={field}>
                <span style={lbl}>Lot size (pcs)</span>
                <input style={{ ...input, ...mono }} defaultValue="3,200" />
              </div>
              <div style={field}>
                <span style={lbl}>Cartons</span>
                <input style={{ ...input, ...mono }} defaultValue="128" />
              </div>
              <div style={field}>
                <span style={lbl}>Inspection type</span>
                <div style={select}><span>Pre-shipment</span><ChevronDown size={15} color={ui.faint} /></div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={sectionTitle}>Procedure &amp; assignment</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              <div style={field}>
                <span style={lbl}>Loop preset</span>
                <div style={{ ...select, height: 56 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 8, background: ui.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Repeat size={18} color={ui.accent} />
                    </span>
                    <span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>Standard Knit Shirt</span>
                      <span style={{ fontSize: 12, color: ui.sub }}>6 loops · 28 required shots</span>
                    </span>
                  </span>
                  <ChevronDown size={15} color={ui.faint} />
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['01 Fabric', '02 Stitching', '03 Collar', '04 Sleeves', '05 Buttons', '06 Final'].map((n) => (
                  <span key={n} style={{ fontSize: 11.5, padding: '4px 8px', borderRadius: 5, background: ui.lineSoft, color: ui.sub, fontWeight: 500 }}>{n}</span>
                ))}
              </div>
              <div style={field}>
                <span style={lbl}>Assigned inspector</span>
                <div style={select}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Avatar initials="DM" size={22} bg="#0B7D6B" /> Deepak Menon
                    <RoleBadge role="inspector" />
                  </span>
                  <ChevronDown size={15} color={ui.faint} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'sticky', top: 0 }}>
          <div style={{ background: ui.ink, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Computed AQL plan</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: '#6FE39A' }} /> Auto
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {([['Level', aqlPlan.level], ['Code', aqlPlan.codeLetter], ['Sample n', aqlPlan.sampleSize]] as const).map(([k, v]) => (
                  <div key={k} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</div>
                    <div style={{ ...mono, fontSize: 20, fontWeight: 600, color: '#fff', marginTop: 3 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 20px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <span>Class</span>
                <span style={{ width: 52, textAlign: 'right' }}>AQL</span>
                <span style={{ width: 44, textAlign: 'right' }}>Ac</span>
                <span style={{ width: 44, textAlign: 'right' }}>Re</span>
              </div>
              {aqlPlan.classes.map((c) => {
                const s = severity[c.sev];
                return (
                  <div key={c.sev} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#fff' }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: s.dot }} /> {s.label}
                    </span>
                    <span style={{ ...mono, width: 52, textAlign: 'right', fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>{c.aql}</span>
                    <span style={{ ...mono, width: 44, textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#6FE39A' }}>{c.ac}</span>
                    <span style={{ ...mono, width: 44, textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#F49A9A' }}>{c.re}</span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Per ANSI/ASQ Z1.4 · single sampling, normal</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#7FB6FF', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Settings size={12} color="#7FB6FF" /> Advanced
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: ui.lineSoft, border: `1px solid ${ui.line}`, borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Lock size={14} color={ui.sub} />
              <span style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Audit-locked block</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {([
                ['Inspector', 'Deepak Menon', false, false],
                ['Device ID', 'Captured at submit', true, true],
                ['Submitted at', 'On Admin submit', true, true],
                ['GPS', 'On Admin submit', true, true],
              ] as const).map(([k, v, isMono, pending]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: ui.sub, minWidth: 78 }}>{k}</span>
                  <span style={{ flex: 1, color: pending ? ui.faint : ui.ink, ...(isMono ? mono : {}), fontSize: isMono ? 12 : 13, fontStyle: pending ? 'italic' : 'normal' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: ui.sub, borderTop: `1px solid ${ui.line}`, paddingTop: 11, marginTop: 12, lineHeight: 1.45 }}>
              These fields lock automatically on submit. They cannot be edited and appear verbatim in the final report.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

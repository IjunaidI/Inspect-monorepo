import type { CSSProperties } from 'react';
import { ArrowRight, ChevronDown, MoreVertical, Plus, Search } from 'lucide-react';
import { Btn, PageHead } from '@/components/inspect/shell';
import { mono, ui } from '@/components/inspect/tokens';
import { loadOrFallback, type ApiLoopPreset } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PresetRow {
  name: string;
  industry: string;
  desc: string;
  loops: [string, number][];
  loopCount: number;
  used: number | string;
  edited: string;
}

const DEMO_PRESETS: PresetRow[] = [
  { name: 'Standard Knit Shirt', industry: 'Garments', desc: '6 loops · ANSI Z1.4', loops: [['Fabric inspection', 4], ['Stitching & seams', 6], ['Collar & neckline', 5], ['Sleeves & cuffs', 4], ['Buttons & buttonholes', 5]], loopCount: 6, used: 12, edited: '2 days ago' },
  { name: 'Bath Towel — 500 GSM', industry: 'Home Textiles', desc: '4 loops · weight check', loops: [['Pile uniformity', 3], ['Edge hemming', 2], ['GSM weighing', 1], ['Color & dye', 2]], loopCount: 4, used: 5, edited: '6 hours ago' },
  { name: 'Bedding Set — King', industry: 'Home Textiles', desc: '7 loops · seam strength', loops: [['Fabric inspection', 4], ['Flat sheet seams', 5], ['Fitted corners', 4], ['Pillowcase stitching', 3], ['Embroidery', 2]], loopCount: 7, used: 8, edited: 'Yesterday' },
  { name: 'Cotton Trouser', industry: 'Garments', desc: '5 loops · pocket integrity', loops: [['Fabric & shade', 4], ['Side seam & inseam', 6], ['Waistband', 3], ['Pockets & zipper', 5], ['Hem finishing', 3]], loopCount: 5, used: 9, edited: '3 days ago' },
  { name: 'Denim Heavy', industry: 'Garments', desc: '6 loops · rivet check', loops: [['Fabric & weight', 3], ['Side & inseam', 6], ['Waistband & belt loops', 4], ['Rivets & hardware', 5], ['Wash & shade', 2]], loopCount: 6, used: 4, edited: 'Last week' },
  { name: 'Curtain Panel', industry: 'Home Textiles', desc: '4 loops · pleat alignment', loops: [['Fabric drop', 3], ['Header & pleats', 4], ['Side hems', 2], ['Lining attachment', 3]], loopCount: 4, used: 3, edited: '2 weeks ago' },
];

const industryTag = (industry: string): CSSProperties => {
  const map: Record<string, { bg: string; fg: string }> = {
    Textile: { bg: '#EAF3FB', fg: '#1457A3' },
    Garments: { bg: '#F1EEFB', fg: '#5B45B0' },
    'Home Textiles': { bg: '#EAF6F0', fg: '#1F6B43' },
    '—': { bg: ui.lineSoft, fg: ui.faint },
  };
  const c = map[industry] ?? map['—'];
  return { display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 500, background: c.bg, color: c.fg, letterSpacing: 0.1 };
};

const card: CSSProperties = { background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 };
const monoChip: CSSProperties = { ...mono, fontSize: 11.5 };

export default async function PresetsPage() {
  const { data, live } = await loadOrFallback<ApiLoopPreset[]>('/loop-presets', []);
  const presets: PresetRow[] = live
    ? data.map((p) => ({
        name: p.name,
        industry: '—',
        desc: `v${p.version}${p.description ? ` · ${p.description}` : ''}`,
        loops: [],
        loopCount: p._count?.steps ?? 0,
        used: '—',
        edited: '—',
      }))
    : DEMO_PRESETS;

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Loop Presets"
        sub="Reusable inspection sequences. Attach to buyers or individual inspections."
        actions={<Btn kind="primary" icon={<Plus size={15} />} href="/presets/new">New Preset</Btn>}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
          <input style={{ width: 320, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }} placeholder="Search presets…" />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</span>
          <div style={{ height: 30, padding: '0 10px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, color: ui.sub, fontSize: 12.5 }}>
            Last edited <ChevronDown size={14} color={ui.sub} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {presets.map((p) => (
          <div key={p.name} style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={industryTag(p.industry)}>{p.industry}</span>
                  <span style={{ fontSize: 11.5, color: ui.faint }}>{p.desc}</span>
                </div>
              </div>
              <div style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint }}>
                <MoreVertical size={15} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${ui.lineSoft}`, paddingTop: 10, minHeight: 40 }}>
              {p.loops.length > 0 ? (
                <>
                  {p.loops.map(([name, shots], j) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
                      <span style={{ ...monoChip, color: ui.faint, minWidth: 22 }}>{String(j + 1).padStart(2, '0')}</span>
                      <span style={{ flex: 1, fontSize: 12.5, color: ui.ink }}>{name}</span>
                      <span style={{ ...monoChip, fontSize: 10.5, padding: '2px 6px', background: ui.lineSoft, color: ui.sub, borderRadius: 4 }}>{shots} shots</span>
                    </div>
                  ))}
                  {p.loopCount > p.loops.length && <div style={{ fontSize: 11.5, color: ui.faint, padding: '4px 0 0', marginLeft: 22 }}>+{p.loopCount - p.loops.length} more</div>}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: ui.sub, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ ...monoChip, color: ui.ink, fontWeight: 600 }}>{p.loopCount}</span> loops in this preset
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${ui.lineSoft}`, paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 11, color: ui.sub }}>Used by <span style={{ ...monoChip, color: ui.ink, fontWeight: 600 }}>{p.used}</span> buyers</div>
                <div style={{ fontSize: 11, color: ui.faint }}>Edited {p.edited}</div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 12.5, color: ui.accent, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                Edit <ArrowRight size={13} color={ui.accent} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

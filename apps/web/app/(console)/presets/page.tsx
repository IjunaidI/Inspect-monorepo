import type { CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import { Btn, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { loadOrFallback, type ApiLoopPreset } from '@/lib/api';
import { PresetsList } from './presets-list';

export const dynamic = 'force-dynamic';

export interface PresetRow {
  id: string;
  name: string;
  industry: string;
  desc: string;
  loops: [string, number][];
  loopCount: number;
  used: number | string;
  edited: string;
}

const DEMO_PRESETS: PresetRow[] = [
  { id: 'demo-1', name: 'Standard Knit Shirt', industry: 'Garments', desc: '6 loops · ANSI Z1.4', loops: [['Fabric inspection', 4], ['Stitching & seams', 6], ['Collar & neckline', 5], ['Sleeves & cuffs', 4], ['Buttons & buttonholes', 5]], loopCount: 6, used: 12, edited: '2 days ago' },
  { id: 'demo-2', name: 'Bath Towel — 500 GSM', industry: 'Home Textiles', desc: '4 loops · weight check', loops: [['Pile uniformity', 3], ['Edge hemming', 2], ['GSM weighing', 1], ['Color & dye', 2]], loopCount: 4, used: 5, edited: '6 hours ago' },
  { id: 'demo-3', name: 'Bedding Set — King', industry: 'Home Textiles', desc: '7 loops · seam strength', loops: [['Fabric inspection', 4], ['Flat sheet seams', 5], ['Fitted corners', 4], ['Pillowcase stitching', 3], ['Embroidery', 2]], loopCount: 7, used: 8, edited: 'Yesterday' },
  { id: 'demo-4', name: 'Cotton Trouser', industry: 'Garments', desc: '5 loops · pocket integrity', loops: [['Fabric & shade', 4], ['Side seam & inseam', 6], ['Waistband', 3], ['Pockets & zipper', 5], ['Hem finishing', 3]], loopCount: 5, used: 9, edited: '3 days ago' },
  { id: 'demo-5', name: 'Denim Heavy', industry: 'Garments', desc: '6 loops · rivet check', loops: [['Fabric & weight', 3], ['Side & inseam', 6], ['Waistband & belt loops', 4], ['Rivets & hardware', 5], ['Wash & shade', 2]], loopCount: 6, used: 4, edited: 'Last week' },
  { id: 'demo-6', name: 'Curtain Panel', industry: 'Home Textiles', desc: '4 loops · pleat alignment', loops: [['Fabric drop', 3], ['Header & pleats', 4], ['Side hems', 2], ['Lining attachment', 3]], loopCount: 4, used: 3, edited: '2 weeks ago' },
];

export const industryTag = (industry: string): CSSProperties => {
  const map: Record<string, { bg: string; fg: string }> = {
    Textile: { bg: '#EAF3FB', fg: '#1457A3' },
    Garments: { bg: '#F1EEFB', fg: '#5B45B0' },
    'Home Textiles': { bg: '#EAF6F0', fg: '#1F6B43' },
    '—': { bg: ui.lineSoft, fg: ui.faint },
  };
  const c = map[industry] ?? map['—'];
  return { display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 500, background: c.bg, color: c.fg, letterSpacing: 0.1 };
};

export default async function PresetsPage() {
  const { data, live } = await loadOrFallback<ApiLoopPreset[]>('/loop-presets', []);
  const presets: PresetRow[] = live
    ? data.map((p) => ({
        id: p.id,
        name: p.name,
        industry: '—',
        desc: `v${p.version}${p.description ? ` · ${p.description}` : ''}`,
        loops: [],
        loopCount: p._count?.steps ?? 0,
        used: '—',
        edited: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—',
      }))
    : DEMO_PRESETS;

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Loop Presets"
        sub="Reusable inspection sequences. Attach to buyers or individual inspections."
        actions={<Btn kind="primary" icon={<Plus size={15} />} href="/presets/new">New Preset</Btn>}
      />
      <PresetsList presets={presets} live={live} />
    </div>
  );
}

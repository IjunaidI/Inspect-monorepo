/**
 * Inspect mobile v2 — design canvas generator.
 *
 * Emits one `.dc.html` artboard per phone screen (390×844) plus `canvas.json`,
 * all painted with the v2 tokens (see docs/reference/design-system.md). Icons
 * are inline SVG: Solar (CC BY 4.0, 480 Design) from ./solar-icons.json —
 * BOLD for navigation/actions, LINEAR for content glyphs — plus a handful of
 * custom garment glyphs drafted here (the same paths seed
 * packages/design-tokens/src/icons.ts).
 *
 *   node design/inspect-canvas/build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const solar = JSON.parse(
  readFileSync(join(here, 'solar-icons.json'), 'utf8'),
).icons;

// ── tokens ──────────────────────────────────────────────────────────────────
const T = {
  bg: '#FDFCF8',
  fg: '#1A331C',
  card: '#FFFFFF',
  primary: '#3A7D44',
  primaryFg: '#FFFFFF',
  primarySoft: 'rgba(58,125,68,0.10)',
  primaryFaint: 'rgba(58,125,68,0.05)',
  secondary: '#E8DDCB',
  secondaryFg: '#2F4F34',
  muted: '#F2EEE6',
  mutedFg: '#5C6B5E',
  faint: '#8C9E8D',
  accent: '#DCB878',
  accentSoft: 'rgba(220,184,120,0.20)',
  accentStrong: '#8A6A1F',
  destructive: '#CF4444',
  destructiveSoft: 'rgba(207,68,68,0.10)',
  warning: '#C25E00',
  warningSoft: 'rgba(194,94,0,0.12)',
  info: '#4A63C8',
  infoSoft: 'rgba(92,124,250,0.12)',
  border: '#E6E0D4',
  borderSoft: '#F0ECE3',
  input: '#F2EEE6',
  scrim: 'rgba(26,51,28,0.45)',
  shadowSm: '0 1px 2px rgba(26,51,28,0.05)',
  shadowMd: '0 4px 12px rgba(26,51,28,0.08)',
  shadowLg: '0 12px 32px rgba(26,51,28,0.12)',
};
const SANS = "'Inter', -apple-system, system-ui, sans-serif";
const SERIF = "'Libre Baskerville', Georgia, serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

// ── icons ───────────────────────────────────────────────────────────────────
const stroke = (inner) =>
  `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
/** Custom garment glyphs — linear style to sit beside Solar linear. Drafts. */
const CUSTOM = {
  collar: stroke(
    '<path d="M4 4C7 2.8 17 2.8 20 4"/><path d="M4 4L10 13L12 8L14 13L20 4"/><path d="M12 8V21.5"/>',
  ),
  neckhole: stroke(
    '<ellipse cx="12" cy="11" rx="9" ry="6"/><ellipse cx="12" cy="11" rx="5" ry="3"/><path d="M10 17.5H14V21H10Z"/>',
  ),
  sleeve: stroke(
    '<path d="M3.5 5H12L20.5 13.5L17 17L12.5 12.5H10V21H3.5Z"/><path d="M3.5 17H10"/>',
  ),
  cuff: stroke(
    '<path d="M3 8.5H21V15.5H3Z"/><path d="M6 12H10"/><circle cx="15.5" cy="12" r="1.2"/>',
  ),
  shoulder: stroke(
    '<path d="M3 9L8 4H16L21 9"/><path d="M8 4V21H16V4"/><path d="M5.5 9H8M16 9H18.5"/>',
  ),
  placket: stroke(
    '<path d="M8 3H16V21H8Z"/><circle cx="12" cy="8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="16" r="1"/>',
  ),
  pocket: stroke(
    '<path d="M5 4H19V13.5C19 17.5 16 20 12 20C8 20 5 17.5 5 13.5Z"/><path d="M5 7.5H19"/>',
  ),
  hem: stroke(
    '<path d="M3 7C6 5 9 5 12 7C15 9 18 9 21 7V18H3Z"/><path d="M5.5 14.5H18.5" stroke-dasharray="2 2"/>',
  ),
  seam: stroke(
    '<path d="M3 5L10 12L3 19M21 5L14 12L21 19"/><path d="M10 12H14" stroke-dasharray="1.5 1.5"/>',
  ),
  yoke: stroke('<path d="M3 5H21L19 10H5Z"/><path d="M5 10V21H19V10"/>'),
  zipper: stroke(
    '<path d="M12 3V21"/><path d="M9.5 6H12M12 8.5H14.5M9.5 11H12M12 13.5H14.5M9.5 16H12"/><path d="M10 17.5H14V21H10Z"/>',
  ),
  waistband: stroke(
    '<path d="M3 6H21V11H3Z"/><path d="M8 6V11M16 6V11"/><path d="M3.5 11L5 21M20.5 11L19 21M12 11V21"/>',
  ),
  polybag: stroke(
    '<path d="M5.5 8.5H18.5L19.5 21H4.5Z"/><path d="M9 8.5V6.5C9 4.5 15 4.5 15 6.5V8.5"/>',
  ),
  print: stroke(
    '<path d="M4 4H20V20H4Z"/><path d="M8 15L11 11L13.5 14L15.5 12L17 15"/>',
  ),
};
function icon(name, size = 20, color = 'currentColor', extra = '') {
  const body = CUSTOM[name] ?? solar[name]?.body;
  if (!body) throw new Error(`unknown icon ${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" style="display:block;flex:none;color:${color};${extra}">${body}</svg>`;
}

// ── css ─────────────────────────────────────────────────────────────────────
const CSS = `
  body { margin: 0; background: ${T.bg}; }
  a { color: ${T.primary}; } a:hover { color: ${T.secondaryFg}; }
  .screen { position: relative; width: 390px; height: 844px; overflow: hidden; background: ${T.bg}; color: ${T.fg}; font-family: ${SANS}; font-size: 14px; line-height: 20px; -webkit-font-smoothing: antialiased; }
  .serif { font-family: ${SERIF}; font-weight: 400; }
  .mono { font-family: ${MONO}; font-variant-numeric: tabular-nums; }
  .title { font-family: ${SERIF}; font-size: 24px; line-height: 30px; font-weight: 400; color: ${T.fg}; margin: 0; }
  .heading { font-family: ${SERIF}; font-size: 18px; line-height: 24px; font-weight: 400; color: ${T.fg}; margin: 0; }
  .overline { font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: ${T.mutedFg}; }
  .label { font-size: 12px; line-height: 16px; font-weight: 700; }
  .caption { font-size: 11px; line-height: 14px; font-weight: 500; color: ${T.mutedFg}; }
  .strong { font-weight: 700; }
  .card { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 16px; box-shadow: ${T.shadowSm}; }
  .header { padding: 48px 24px 20px; background: ${T.card}; border-bottom: 1px solid ${T.border}; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .main { padding: 20px 24px 0; display: flex; flex-direction: column; gap: 20px; }
  .tabbar { position: absolute; left: 0; right: 0; bottom: 0; height: 84px; box-sizing: border-box; padding: 8px 16px 20px; background: rgba(255,255,255,0.95); border-top: 1px solid ${T.border}; display: flex; justify-content: space-around; align-items: center; }
  .tab { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 64px; min-height: 44px; justify-content: center; color: ${T.mutedFg}; font-size: 10px; line-height: 12px; font-weight: 500; }
  .tab.active { color: ${T.primary}; font-weight: 700; }
  .row { display: flex; align-items: center; gap: 12px; }
  .chip { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 999px; background: ${T.muted}; color: ${T.mutedFg}; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .chip.active { background: ${T.primarySoft}; color: ${T.primary}; box-shadow: inset 0 0 0 1px ${T.primary}; }
  .badge { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px; font-size: 10px; line-height: 14px; font-weight: 700; white-space: nowrap; }
  .tile { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex: none; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 12px; font-size: 14px; font-weight: 700; box-sizing: border-box; }
  .btn.primary { background: ${T.primary}; color: ${T.primaryFg}; }
  .btn.secondary { background: ${T.card}; color: ${T.fg}; border: 1px solid ${T.border}; }
  .btn.ghost { background: transparent; color: ${T.primary}; }
  .input { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border-radius: 10px; background: ${T.input}; border: 1px solid ${T.border}; color: ${T.faint}; font-size: 14px; box-sizing: border-box; }
  .hscroll { display: flex; gap: 12px; overflow: hidden; }
  .avatar { width: 40px; height: 40px; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; font-weight: 700; flex: none; }
`;

const FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Libre+Baskerville:wght@400;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">';

function page(bodyHtml) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>${CSS}</style>
</helmet>
${bodyHtml}
</x-dc>
</body>
</html>
`;
}

// ── primitives ──────────────────────────────────────────────────────────────
const TONES = {
  neutral: { fg: T.mutedFg, bg: T.muted, dot: T.faint },
  primary: { fg: T.primary, bg: T.primarySoft, dot: T.primary },
  success: { fg: T.primary, bg: T.primarySoft, dot: T.primary },
  info: { fg: T.info, bg: T.infoSoft, dot: '#5C7CFA' },
  warning: { fg: T.warning, bg: T.warningSoft, dot: T.warning },
  danger: { fg: T.destructive, bg: T.destructiveSoft, dot: T.destructive },
  accent: { fg: T.accentStrong, bg: T.accentSoft, dot: T.accent },
};
const badge = (tone, text) =>
  `<span class="badge" style="background:${TONES[tone].bg};color:${TONES[tone].fg}">${text}</span>`;
const dot = (tone) =>
  `<span style="width:8px;height:8px;border-radius:999px;background:${TONES[tone].dot};display:inline-block;flex:none"></span>`;

function tile(
  name,
  tone = 'primary',
  size = 48,
  iconSize = 24,
  linear = false,
) {
  const c = TONES[tone];
  return `<div class="tile" style="width:${size}px;height:${size}px;background:${c.bg}">${icon(name, iconSize, c.fg)}</div>`;
}
function avatar(initials, bg = T.primary, size = 40) {
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size / 3)}px">${initials}</div>`;
}
function header({ overline, title, action, back, right }) {
  const left = `<div class="row" style="gap:16px;min-width:0">
      ${back ? `<div style="width:40px;height:40px;border-radius:999px;border:1px solid ${T.border};display:flex;align-items:center;justify-content:center;flex:none">${icon('arrow-left-linear', 24, T.fg)}</div>` : ''}
      <div style="min-width:0">
        ${overline ? `<div class="overline" style="margin-bottom:4px">${overline}</div>` : ''}
        <h1 class="title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</h1>
      </div>
    </div>`;
  const r =
    right ??
    (action
      ? `<div style="color:${T.primary};font-size:14px;font-weight:700">${action}</div>`
      : '');
  return `<header class="header">${left}${r}</header>`;
}
function tabBar(active, { inspector = false } = {}) {
  const tabs = [
    ['home', 'Home', 'home-2-bold'],
    ['inspections', 'Inspections', 'checklist-minimalistic-bold'],
    ...(inspector ? [] : [['library', 'Library', 'notebook-bookmark-bold']]),
    ['profile', 'Profile', 'user-bold'],
  ];
  return `<nav class="tabbar">${tabs
    .map(
      ([k, label, ic]) =>
        `<div class="tab${k === active ? ' active' : ''}">${icon(ic, 24)}<span>${label}</span></div>`,
    )
    .join('')}</nav>`;
}
const sectionLabel = (text, action) =>
  `<div class="row" style="justify-content:space-between"><div class="overline">${text}</div>${
    action
      ? `<div style="color:${T.primary};font-size:12px;font-weight:700">${action}</div>`
      : ''
  }</div>`;
const sectionHeading = (text, action) =>
  `<div class="row" style="justify-content:space-between;align-items:flex-end"><h2 class="heading">${text}</h2>${
    action
      ? `<div style="color:${T.primary};font-size:14px;font-weight:600">${action}</div>`
      : ''
  }</div>`;

function statCard({
  label,
  value,
  tone = 'primary',
  delta,
  deltaTone = 'success',
  hint,
}) {
  return `<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0">
    <div class="row" style="gap:8px">${dot(tone)}<span class="label" style="color:${T.mutedFg}">${label}</span></div>
    <div style="display:flex;align-items:baseline;gap:6px">
      <span class="serif" style="font-size:24px;line-height:30px">${value}</span>
      ${delta ? `<span class="caption" style="color:${TONES[deltaTone].fg};font-weight:600">${delta}</span>` : ''}
    </div>
    ${hint ? `<div class="caption">${hint}</div>` : ''}
  </div>`;
}
function listRow({
  title,
  sub,
  right,
  leading,
  chevron = false,
  inset = false,
}) {
  const body = `<div class="row" style="justify-content:space-between;gap:12px;padding:${inset ? '16px 20px' : '16px'}">
    <div class="row" style="gap:14px;min-width:0">
      ${leading ?? ''}
      <div style="min-width:0">
        <div class="strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
        ${sub ? `<div class="caption" style="margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>` : ''}
      </div>
    </div>
    <div class="row" style="gap:10px;flex:none">${right ?? ''}${chevron ? icon('alt-arrow-right-linear', 18, T.faint) : ''}</div>
  </div>`;
  return inset ? body : `<div class="card">${body}</div>`;
}
const listCard = (rows) =>
  `<div class="card" style="border-radius:20px;overflow:hidden">${rows
    .map(
      (r, i) =>
        `<div style="${i ? `border-top:1px solid ${T.borderSoft}` : ''}">${r}</div>`,
    )
    .join('')}</div>`;

function quickTile({ icon: ic, tone, title, sub }) {
  return `<div class="card" style="min-width:124px;padding:14px 12px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px">
    <div style="width:48px;height:48px;border-radius:999px;background:${TONES[tone].bg};display:flex;align-items:center;justify-content:center">${icon(ic, 24, TONES[tone].fg)}</div>
    <div class="label">${title}</div>
    <div class="caption" style="margin-top:-4px">${sub}</div>
  </div>`;
}

// ── screens ─────────────────────────────────────────────────────────────────
function homeQA() {
  return `<div class="screen">
  ${header({
    overline: 'Acme Apparel Group',
    title: 'Good morning, Riya',
    right: avatar('RS', T.primary),
  })}
  <main class="main">
    <section style="display:flex;flex-direction:column;gap:12px">
      ${sectionLabel('Quick start')}
      <div class="hscroll">
        ${quickTile({ icon: 'camera-bold', tone: 'primary', title: 'New inspection', sub: 'Pick a PO' })}
        ${quickTile({ icon: 'checklist-minimalistic-bold', tone: 'accent', title: 'New loop', sub: 'Build a preset' })}
        ${quickTile({ icon: 'document-text-bold', tone: 'neutral', title: 'Reports', sub: '31 signed' })}
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:12px">
      ${sectionLabel('Pipeline', 'This month')}
      <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px">
        ${statCard({ label: 'In progress', value: '4', tone: 'info' })}
        ${statCard({ label: 'Awaiting review', value: '2', tone: 'warning' })}
        ${statCard({ label: 'Pass rate', value: '92%', tone: 'success', delta: '+3' })}
        ${statCard({ label: 'DPHU', value: '1.8', tone: 'accent', delta: '−0.4' })}
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:12px">
      ${sectionHeading('Recent inspections', 'View all')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${listRow({ title: 'PO-4471 · Knit polo', sub: 'Northwind Retail · Sunrise Garments · today', right: badge('info', 'In progress') })}
        ${listRow({ title: 'PO-4466 · Chino trouser', sub: 'Northwind Retail · Delta Mills · yesterday', right: badge('warning', 'Awaiting review') })}
      </div>
    </section>
  </main>
  ${tabBar('home')}
</div>`;
}

function homeInspector() {
  return `<div class="screen">
  ${header({ overline: 'Acme Apparel Group', title: 'Good morning, Arjun', right: avatar('AM', '#8A6A1F') })}
  <main class="main">
    <section class="card" style="background:${T.primaryFaint};border-color:${T.primarySoft};padding:20px;display:flex;flex-direction:column;gap:16px;box-shadow:none">
      <div class="row" style="gap:14px">
        ${tile('play-circle-bold', 'primary')}
        <div style="min-width:0">
          <div class="overline" style="color:${T.primary}">Continue where you left off</div>
          <div class="strong" style="font-size:16px;line-height:22px;margin-top:4px">PO-4471 · Knit polo</div>
          <div class="caption" style="margin-top:2px">Unit 3 of 8 · 2 shots left in this unit</div>
        </div>
      </div>
      <div class="btn primary">${icon('camera-bold', 20, T.primaryFg)}Resume capture</div>
    </section>
    <section style="display:flex;flex-direction:column;gap:12px">
      ${sectionLabel('My work')}
      <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px">
        ${statCard({ label: 'Assigned to me', value: '3', tone: 'neutral' })}
        ${statCard({ label: 'In progress', value: '1', tone: 'info' })}
        ${statCard({ label: 'Awaiting review', value: '2', tone: 'warning' })}
        ${statCard({ label: 'Decided this month', value: '14', tone: 'success' })}
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:12px">
      ${sectionHeading('Assigned to you', 'All')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${listRow({ title: 'PO-4480 · Fleece hoodie', sub: 'Harbor &amp; Co · Delta Mills · due Fri', right: badge('neutral', 'Assigned') })}
        ${listRow({ title: 'PO-4478 · Denim jacket', sub: 'Northwind Retail · Sunrise Garments · due Mon', right: badge('neutral', 'Assigned') })}
      </div>
    </section>
  </main>
  ${tabBar('home', { inspector: true })}
</div>`;
}

function inspections() {
  const rows = [
    [
      'PO-4471 · Knit polo',
      'Northwind Retail · KP-2210 · today',
      badge('info', 'In progress'),
    ],
    [
      'PO-4466 · Chino trouser',
      'Northwind Retail · CT-118 · yesterday',
      badge('warning', 'Awaiting review'),
    ],
    [
      'PO-4460 · Fleece hoodie',
      'Harbor &amp; Co · FH-04 · 8 Sep',
      badge('warning', 'Awaiting review'),
    ],
    [
      'PO-4452 · Oxford shirt',
      'Harbor &amp; Co · OX-77 · 3 Sep',
      badge('success', 'Approved'),
    ],
    [
      'PO-4449 · Cargo short',
      'Northwind Retail · CS-31 · 1 Sep',
      badge('danger', 'Rejected'),
    ],
    [
      'PO-4441 · Linen dress',
      'Meridian Home · LD-09 · 28 Aug',
      badge('success', 'Report issued'),
    ],
  ];
  return `<div class="screen">
  ${header({ title: 'Inspections', action: 'New' })}
  <main class="main" style="gap:16px">
    <div class="input">${icon('magnifier-linear', 20, T.faint)}<span>Search PO, style or client</span></div>
    <div class="hscroll" style="gap:8px">
      <span class="chip active">All · 23</span><span class="chip">In progress</span><span class="chip">Awaiting review</span><span class="chip">Decided</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${rows.map(([t, s, b]) => listRow({ title: t, sub: s, right: b, chevron: true })).join('')}
    </div>
  </main>
  ${tabBar('inspections')}
</div>`;
}

function library() {
  const row = (ic, title, sub, count) =>
    listRow({
      inset: true,
      leading: tile(ic, 'primary', 40, 20),
      title,
      sub,
      right: `<span class="caption strong" style="color:${T.mutedFg}">${count}</span>`,
      chevron: true,
    });
  return `<div class="screen">
  ${header({ title: 'Library' })}
  <main class="main">
    <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:12px">
      <div class="overline">Most used loop</div>
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="strong" style="font-size:16px;line-height:22px">Knit polo — full</div>
          <div class="caption" style="margin-top:2px">v3 · 12 shots · 14 inspections</div>
        </div>
        <div class="btn secondary" style="height:40px;padding:0 14px;font-size:13px">Duplicate</div>
      </div>
    </section>
    ${listCard([
      row(
        'checklist-minimalistic-bold',
        'Loop presets',
        'Capture loops, one image per shot',
        '6',
      ),
      row('box-bold', 'Products', 'Style numbers', '48'),
      row(
        'bill-list-bold',
        'Purchase orders',
        'Client · factory · quantity',
        '23',
      ),
      row('buildings-2-bold', 'Companies', 'Clients and factories', '12'),
      row('shield-check-bold', 'Signed reports', 'Ed25519-signed PDFs', '31'),
      row('users-group-rounded-bold', 'Team', 'Members and roles', '8'),
    ])}
  </main>
  ${tabBar('library')}
</div>`;
}

function profile() {
  const stat = (v, l) =>
    `<div style="text-align:center"><div class="serif" style="font-size:20px;line-height:26px">${v}</div><div class="overline">${l}</div></div>`;
  const divider = `<div style="width:1px;height:32px;background:${T.border};align-self:center"></div>`;
  const row = (ic, label, right, tone) =>
    `<div class="row" style="justify-content:space-between;padding:16px 20px;gap:12px">
      <div class="row" style="gap:16px">${icon(ic, 20, tone === 'danger' ? T.destructive : T.mutedFg)}<span style="font-weight:500;color:${tone === 'danger' ? T.destructive : T.fg}">${label}</span></div>
      <div class="row" style="gap:8px">${right ?? ''}${tone === 'danger' ? '' : icon('arrow-right-linear', 16, T.faint)}</div>
    </div>`;
  return `<div class="screen">
  <header style="padding:64px 24px 40px;text-align:center;background:linear-gradient(180deg, ${T.primarySoft} 0%, ${T.bg} 100%)">
    <div style="position:relative;display:inline-block;margin-bottom:16px">
      ${avatar('RS', T.primary, 112)}
      <div style="position:absolute;right:4px;bottom:4px;width:32px;height:32px;border-radius:999px;background:${T.primary};border:2px solid ${T.bg};display:flex;align-items:center;justify-content:center;box-shadow:${T.shadowMd}">${icon('pen-bold', 16, T.primaryFg)}</div>
    </div>
    <h1 class="title">Riya Saraf</h1>
    <div class="caption" style="margin-top:4px;font-size:14px;line-height:20px;font-weight:400">QA Manager · Acme Apparel Group</div>
    <div class="row" style="justify-content:center;gap:24px;margin-top:24px">${stat('142', 'Inspections')}${divider}${stat('92%', 'Pass rate')}${divider}${stat('31', 'Reports')}</div>
  </header>
  <main class="main" style="padding-top:8px">
    ${listCard([
      row('settings-bold', 'Account settings'),
      row('users-group-rounded-bold', 'Team', badge('accent', 'Owner')),
      row('link-bold', 'Open the web console'),
      row('question-square-bold', 'Help &amp; support'),
      row('logout-bold', 'Sign out', '', 'danger'),
    ])}
    <div class="caption" style="text-align:center">API · <span class="mono">main-application-production-6fa4.up.railway.app</span></div>
  </main>
  ${tabBar('profile')}
</div>`;
}

const LOOP = [
  [
    'collar',
    'Collar &amp; neckline',
    'Collar buttoned and standing; both points in frame',
  ],
  [
    'neckhole',
    'Neck hole inside',
    'Shoot down into the neck: tape, seam, label stitching',
  ],
  ['sleeve', 'Left sleeve', 'Laid straight, shoulder seam to cuff, seam up'],
  ['sleeve', 'Right sleeve', 'Laid straight, shoulder seam to cuff, seam up'],
  ['hem', 'Hem', 'Flat across the full width; stitch line visible'],
  ['tag-linear', 'Care label', 'Unfolded; every symbol readable'],
];
function loopRow([ic, name, desc], i, { lifted = false } = {}) {
  return `<div class="card" style="padding:12px 12px 12px 14px;display:flex;align-items:center;gap:12px;${
    lifted
      ? `box-shadow:${T.shadowLg};border-color:${T.primary};transform:scale(1.02) rotate(-0.4deg);`
      : ''
  }">
    <div style="width:26px;height:26px;border-radius:999px;background:${T.primarySoft};color:${T.primary};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">${i + 1}</div>
    ${tile(ic, 'neutral', 40, 22)}
    <div style="min-width:0;flex:1">
      <div class="strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
      <div class="caption" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${desc}</div>
    </div>
    <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;flex:none;margin:-8px -8px -8px 0">${icon('hamburger-menu-linear', 22, lifted ? T.primary : T.faint)}</div>
  </div>`;
}
function loopBuilder() {
  const order = [LOOP[4], LOOP[0], LOOP[1], LOOP[2], LOOP[3]]; // Hem dragged to the top
  return `<div class="screen">
  ${header({ title: 'New loop', back: true, action: 'Save' })}
  <main class="main" style="gap:20px">
    <div style="display:flex;flex-direction:column;gap:6px">
      <div class="overline">Preset name</div>
      <div class="input" style="color:${T.fg};background:${T.card}">Knit polo — full</div>
      <div class="caption">Saving reuses the name as the next version (v4).</div>
    </div>
    <section style="display:flex;flex-direction:column;gap:12px">
      ${sectionLabel('Loop · 5 shots per unit', 'Templates')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${order.map((it, i) => loopRow(it, i, { lifted: i === 0 })).join('')}
      </div>
      <div class="btn secondary" style="border-style:dashed">${icon('add-circle-bold', 20, T.primary)}Add capture points</div>
    </section>
    ${listCard([
      listRow({
        inset: true,
        leading: tile('tag-bold', 'neutral', 40, 20),
        title: 'Defect tags',
        sub: 'Loop-global · 5 selected',
        chevron: true,
      }),
      listRow({
        inset: true,
        leading: tile('ruler-angular-bold', 'neutral', 40, 20),
        title: 'Measurement sheet',
        sub: 'Per unit · 4 fields',
        chevron: true,
      }),
    ])}
  </main>
</div>`;
}

function capturePicker() {
  const tiles = [
    ['collar', 'Collar &amp; neckline', true],
    ['neckhole', 'Neck hole inside', true],
    ['sleeve', 'Left sleeve', false],
    ['sleeve', 'Right sleeve', true],
    ['cuff', 'Left cuff', false],
    ['cuff', 'Right cuff', false],
    ['shoulder', 'Shoulder seam', false],
    ['placket', 'Front placket', false],
    ['pocket', 'Chest pocket', false],
    ['hem', 'Hem tape close-up', false, true],
  ];
  const tileHtml = ([
    ic,
    name,
    checked,
    yours,
  ]) => `<div style="position:relative;border:1px solid ${checked ? T.primary : T.border};background:${checked ? T.primaryFaint : T.card};border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:96px;box-sizing:border-box">
      ${tile(ic, checked ? 'primary' : 'neutral', 40, 22)}
      <div class="label" style="line-height:16px">${name}</div>
      ${yours ? `<span class="badge" style="position:absolute;top:12px;right:12px;background:${T.accentSoft};color:${T.accentStrong}">Yours</span>` : ''}
      ${checked ? `<div style="position:absolute;top:10px;right:10px">${icon('check-circle-bold', 22, T.primary)}</div>` : ''}
    </div>`;
  return `<div class="screen">
  ${header({ title: 'New loop', back: true, action: 'Save' })}
  <main class="main" style="gap:20px">
    <div style="display:flex;flex-direction:column;gap:6px">
      <div class="overline">Preset name</div>
      <div class="input" style="color:${T.fg};background:${T.card}">Knit polo — full</div>
    </div>
    ${sectionLabel('Loop · 3 shots per unit')}
    ${loopRow(LOOP[0], 0)}
  </main>
  <div style="position:absolute;inset:0;background:${T.scrim}"></div>
  <section style="position:absolute;left:0;right:0;bottom:0;height:640px;background:${T.card};border-radius:20px 20px 0 0;box-shadow:${T.shadowLg};display:flex;flex-direction:column;overflow:hidden">
    <div style="display:flex;justify-content:center;padding:10px 0 4px"><div style="width:40px;height:4px;border-radius:999px;background:${T.border}"></div></div>
    <div class="row" style="justify-content:space-between;padding:8px 24px 12px">
      <h2 class="heading">Add capture points</h2>
      <div style="color:${T.mutedFg};font-size:14px;font-weight:600">Cancel</div>
    </div>
    <div style="padding:0 24px 12px"><div class="input">${icon('magnifier-linear', 20, T.faint)}<span>Search the library</span></div></div>
    <div class="hscroll" style="gap:8px;padding:0 24px 16px">
      <span class="chip">All · 58</span><span class="chip">Overall</span><span class="chip active">Tops · 14</span><span class="chip">Bottoms</span><span class="chip">Labels</span>
    </div>
    <div style="padding:0 24px;display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:10px;flex:1;overflow:hidden;align-content:start">
      ${tiles.map(tileHtml).join('')}
      <div style="border:1px dashed ${T.primary};background:${T.primaryFaint};border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:96px;box-sizing:border-box">
        <div class="tile" style="width:40px;height:40px;background:${T.card};border:1px solid ${T.border}">${icon('add-circle-linear', 22, T.primary)}</div>
        <div class="label" style="color:${T.primary}">Custom…</div>
      </div>
    </div>
    <div style="padding:12px 24px 20px;background:${T.card};border-top:1px solid ${T.borderSoft}"><div class="btn primary">Add 3 to loop</div></div>
  </section>
</div>`;
}

function capture() {
  const dots = [1, 1, 1, 0, 2, 3]; // 1 shot · 0 current(shot) · 2 frontier · 3 unreachable
  const dotHtml = dots
    .map((d, i) => {
      const cur = i === 3;
      if (d === 2)
        return `<span style="width:10px;height:10px;border-radius:999px;border:1.5px dashed ${T.primary};box-sizing:border-box"></span>`;
      if (d === 3)
        return `<span style="width:10px;height:10px;border-radius:999px;background:${T.border}"></span>`;
      return `<span style="width:10px;height:10px;border-radius:999px;background:${T.primary};${cur ? 'transform:scale(1.5);box-shadow:0 0 0 3px ' + T.primarySoft : ''}"></span>`;
    })
    .join('');
  return `<div class="screen">
  <header style="padding:48px 20px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px">
    <div class="row" style="gap:6px;color:${T.mutedFg};font-weight:600;font-size:14px">${icon('arrow-left-linear', 20, T.mutedFg)}Close</div>
    <div style="text-align:center;min-width:0">
      <div class="strong" style="font-size:15px">PO-4471 · Knit polo</div>
      <div class="caption">Unit 3 of 8 · shot 4/6</div>
    </div>
    <div class="row" style="gap:6px;color:${T.primary};font-weight:700;font-size:14px">End loop ${badge('warning', '1')}</div>
  </header>
  <div style="margin:0 20px 12px;padding:10px 14px;border-radius:12px;background:${T.muted};display:flex;flex-direction:column;gap:8px">
    <div class="row" style="justify-content:space-between">
      <div class="row" style="gap:8px">${icon('cloud-upload-bold', 18, T.info)}<span class="caption" style="color:${T.fg}">Uploading unit 3 · Left sleeve</span></div>
      <span class="caption mono" style="color:${T.info};font-weight:600">62%</span>
    </div>
    <div style="height:6px;border-radius:999px;background:${T.card};overflow:hidden"><div style="width:62%;height:100%;background:${T.info};border-radius:999px"></div></div>
  </div>
  <div style="margin:0 20px;height:404px;border-radius:16px;background:radial-gradient(120% 80% at 50% 30%, #4a5a4c 0%, #1d2a1f 60%, #0c130d 100%);position:relative;overflow:hidden">
    <div style="position:absolute;left:12px;right:12px;top:12px;padding:10px 12px;border-radius:12px;background:rgba(26,51,28,0.55);color:#fff">
      <div class="row" style="gap:10px">${icon('sleeve', 22, T.accent)}<div><div class="strong" style="color:#fff">Right sleeve</div><div class="caption" style="color:rgba(255,255,255,0.85)">Laid straight, shoulder seam to cuff, seam up</div></div></div>
    </div>
    <div style="position:absolute;left:12px;bottom:12px">${badge('success', 'Saved on server')}</div>
    <div style="position:absolute;right:12px;bottom:12px;color:rgba(255,255,255,0.85)" class="caption mono">a4f9…c21e</div>
  </div>
  <div class="row" style="justify-content:center;gap:12px;padding:16px 20px 8px">${dotHtml}</div>
  <div class="row" style="justify-content:space-between;padding:0 20px">
    <div class="row" style="gap:6px;color:${T.mutedFg};font-weight:600;min-height:44px">${icon('arrow-left-linear', 18, T.mutedFg)}Prev</div>
    <div style="color:${T.primary};font-weight:700;font-size:13px">Jump to next shot</div>
    <div class="row" style="gap:6px;color:${T.mutedFg};font-weight:600;min-height:44px">Next ${icon('arrow-right-linear', 18, T.mutedFg)}</div>
  </div>
  <div class="row" style="justify-content:space-between;padding:8px 28px 0">
    <div style="position:relative;width:52px;height:52px;border-radius:14px;background:${T.secondary};border:1px solid ${T.border};display:flex;align-items:center;justify-content:center">${icon('gallery-wide-bold', 24, T.secondaryFg)}<span class="badge" style="position:absolute;top:-6px;right:-6px;background:${T.primary};color:#fff;height:20px;padding:0 6px">15</span></div>
    <div class="row" style="gap:12px">
      <div class="btn secondary" style="height:44px;padding:0 16px;font-size:13px">${icon('refresh-bold', 18, T.fg)}Retake</div>
      <div class="btn primary" style="height:44px;padding:0 16px;font-size:13px">${icon('tag-bold', 18, T.primaryFg)}Defects</div>
    </div>
  </div>
  <div class="caption" style="text-align:center;padding:16px 20px 0">2 units complete / 8 target · end on any complete unit</div>
</div>`;
}

// ── write ───────────────────────────────────────────────────────────────────
const boards = {
  'Main.dc.html': homeQA(),
  'HomeInspector.dc.html': homeInspector(),
  'Inspections.dc.html': inspections(),
  'Library.dc.html': library(),
  'Profile.dc.html': profile(),
  'LoopBuilder.dc.html': loopBuilder(),
  'CapturePicker.dc.html': capturePicker(),
  'Capture.dc.html': capture(),
};
for (const [file, body] of Object.entries(boards))
  writeFileSync(join(here, file), page(body));

const W = 390,
  H = 844,
  GX = 80,
  GY = 120;
const row1 = [
  'Main.dc.html',
  'HomeInspector.dc.html',
  'Inspections.dc.html',
  'Library.dc.html',
  'Profile.dc.html',
];
const row2 = [
  'LoopBuilder.dc.html',
  'CapturePicker.dc.html',
  'Capture.dc.html',
];
const titles = {
  'Main.dc.html': 'Home — QA Manager',
  'HomeInspector.dc.html': 'Home — Inspector',
  'Inspections.dc.html': 'Inspections',
  'Library.dc.html': 'Library',
  'Profile.dc.html': 'Profile',
  'LoopBuilder.dc.html': 'Loop builder — dragging',
  'CapturePicker.dc.html': 'Loop builder — add capture points',
  'Capture.dc.html': 'Capture',
};
const canvas = {
  artboards: [
    ...row1.map((file, i) => ({
      file,
      title: titles[file],
      x: i * (W + GX),
      y: 0,
      w: W,
      h: H,
    })),
    ...row2.map((file, i) => ({
      file,
      title: titles[file],
      x: i * (W + GX),
      y: H + GY,
      w: W,
      h: H,
    })),
  ],
  annotations: [
    {
      id: 'direction',
      x: 0,
      y: -200,
      w: 520,
      text: 'Inspect mobile v2 — direction\nCream canvas, forest-green primary, sand + gold accents. Libre Baskerville for titles and big numbers, Inter for everything else, JetBrains Mono for ids and hashes. Cards: 1px #E6E0D4 border, 16px radius, whisper shadow. Solar Bold icons for navigation and actions; linear glyphs for content (garment parts are custom drafts).',
    },
    {
      id: 'tabs',
      x: 1410 + W + GX,
      y: -120,
      w: 300,
      text: 'Tabs: Home · Inspections · Library · Profile. Library is hidden for inspectors (3 tabs, see Home — Inspector).',
    },
    {
      id: 'builder',
      x: 0,
      y: H + GY - 110,
      w: 470,
      text: 'Loop builder: rows reorder by dragging the handle (react-native-sortables, haptics on lift/drop). Tapping a row opens an edit sheet with Move up / Move down / Remove as the accessible fallback. Hem is shown mid-drag.',
    },
    {
      id: 'picker',
      x: W + GX,
      y: H + GY - 90,
      w: 470,
      text: 'Capture-point library: global rows seeded per category + the org\'s own ("Yours"). Tap to multi-select in the order shots should happen; Custom… creates an org library row and adds it to the loop.',
    },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(
  join(here, 'canvas.json'),
  JSON.stringify(canvas, null, 2) + '\n',
);
console.log(`wrote ${Object.keys(boards).length} artboards + canvas.json`);

/**
 * Generates src/icons.ts — the curated icon set as inline SVG bodies.
 *
 *   node scripts/build-icons.mjs        (or `pnpm --filter @inspect/design-tokens icons`)
 *
 * Sources: `icons/solar-icons.json` (Iconify export of the Solar set — © 480
 * Design, CC BY 4.0) and the custom garment glyphs below, drafted for the
 * capture-point library because no icon set ships a sleeve or a collar.
 * Rule of use: Solar BOLD for navigation and actions, LINEAR (and the custom
 * glyphs, which are linear-weight) for content.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const solar = JSON.parse(
  readFileSync(join(here, '..', 'icons', 'solar-icons.json'), 'utf8'),
).icons;

/** IconName → Solar icon slug. */
const SOLAR = {
  // navigation
  home: 'home-2-bold',
  inspections: 'checklist-minimalistic-bold',
  library: 'notebook-bookmark-bold',
  profile: 'user-bold',
  stats: 'chart-square-bold',
  // actions & objects (bold)
  camera: 'camera-bold',
  gallery: 'gallery-wide-bold',
  check: 'check-circle-bold',
  close: 'close-circle-bold',
  warning: 'danger-triangle-bold',
  info: 'info-circle-bold',
  signed: 'shield-check-bold',
  report: 'document-text-bold',
  product: 'box-bold',
  purchaseOrder: 'bill-list-bold',
  company: 'buildings-2-bold',
  team: 'users-group-rounded-bold',
  settings: 'settings-bold',
  signOut: 'logout-bold',
  edit: 'pen-bold',
  delete: 'trash-bin-trash-bold',
  add: 'add-circle-bold',
  remove: 'minus-circle-bold',
  search: 'magnifier-bold',
  retry: 'refresh-bold',
  locked: 'lock-bold',
  upload: 'cloud-upload-bold',
  offline: 'cloud-cross-bold',
  copy: 'copy-bold',
  link: 'link-bold',
  measure: 'ruler-angular-bold',
  defect: 'tag-bold',
  play: 'play-circle-bold',
  flag: 'flag-bold',
  medal: 'medal-ribbon-bold',
  help: 'question-square-bold',
  card: 'card-2-bold',
  calendar: 'calendar-bold',
  clock: 'clock-circle-bold',
  history: 'history-bold',
  bell: 'bell-bold',
  eye: 'eye-bold',
  filter: 'filter-bold',
  more: 'menu-dots-bold',
  layers: 'layers-bold',
  scanner: 'scanner-bold',
  delivery: 'delivery-bold',
  tune: 'tuning-2-bold',
  qr: 'qr-code-bold',
  palette: 'palette-bold',
  testTube: 'test-tube-bold',
  mapPoint: 'map-point-bold',
  folder: 'folder-bold',
  fileCheck: 'file-check-bold',
  stopwatch: 'stopwatch-bold',
  widget: 'widget-bold',
  clipboard: 'clipboard-check-bold',
  bag: 'bag-4-bold',
  hanger: 'hanger-bold',
  tshirt: 't-shirt-bold',
  // linear (chevrons, handles, content outlines)
  back: 'arrow-left-linear',
  forward: 'arrow-right-linear',
  chevronDown: 'alt-arrow-down-linear',
  chevronRight: 'alt-arrow-right-linear',
  chevronUp: 'alt-arrow-up-linear',
  dragHandle: 'hamburger-menu-linear',
  sort: 'sort-vertical-linear',
  addOutline: 'add-circle-linear',
  closeOutline: 'close-circle-linear',
  checkOutline: 'check-circle-linear',
  searchOutline: 'magnifier-linear',
  eyeOutline: 'eye-linear',
  eyeClosed: 'eye-closed-linear',
  tshirtOutline: 't-shirt-linear',
  hangerOutline: 'hanger-linear',
  boxOutline: 'box-linear',
  tagOutline: 'tag-linear',
  rulerOutline: 'ruler-linear',
  scannerOutline: 'scanner-linear',
  listCheck: 'list-check-linear',
  uploadOutline: 'upload-linear',
  downloadOutline: 'download-linear',
};

const stroke = (inner) =>
  `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

/** Custom garment glyphs (24×24, linear weight). Drafts — refine on device. */
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

const entries = [];
for (const [name, slug] of Object.entries(SOLAR)) {
  const icon = solar[slug];
  if (!icon)
    throw new Error(`Solar icon missing from icons/solar-icons.json: ${slug}`);
  entries.push([name, icon.body]);
}
for (const [name, body] of Object.entries(CUSTOM)) entries.push([name, body]);
entries.sort(([a], [b]) => a.localeCompare(b));

const q = (s) => JSON.stringify(s);
const out = `/* eslint-disable */
/**
 * AUTO-GENERATED by scripts/build-icons.mjs — do not edit by hand.
 *
 * Inline SVG bodies for the curated Inspect icon set, on a 24×24 viewBox and
 * painted with \`currentColor\`. Solar icons © 480 Design, licensed CC BY 4.0
 * (https://www.figma.com/community/file/1166831539721848736) — attribution
 * lives in docs/reference/design-system.md. The garment glyphs (collar,
 * sleeve, cuff, …) are Inspect's own.
 *
 * Rule of use: BOLD names for navigation and actions; the \`*Outline\`,
 * chevron/handle and garment names (linear weight) for content.
 */

export const ICON_VIEWBOX = '0 0 24 24';

export const icons = {
${entries.map(([name, body]) => `  ${name}: ${q(body)},`).join('\n')}
} as const;

export type IconName = keyof typeof icons;

export const ICON_NAMES = Object.keys(icons) as IconName[];

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(icons, value);
}

/**
 * A complete \`<svg>\` string for one icon — what react-native-svg's \`SvgXml\`
 * takes, and what a web \`img src=data:\` or \`innerHTML\` can render. \`color\`
 * resolves the body's \`currentColor\`.
 */
export function iconSvg(name: IconName, size: number, color: string = 'currentColor'): string {
  return (
    \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="\${ICON_VIEWBOX}" width="\${size}" height="\${size}" color="\${color}">\` +
    icons[name] +
    '</svg>'
  );
}
`;
writeFileSync(join(here, '..', 'src', 'icons.ts'), out);
console.log(
  `wrote src/icons.ts — ${entries.length} icons (${Object.keys(SOLAR).length} Solar, ${Object.keys(CUSTOM).length} custom)`,
);

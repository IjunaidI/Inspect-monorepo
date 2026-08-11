/**
 * INS-003 — the report PDF binary.
 *
 * Renders the FROZEN, SIGNED artifact: everything on the page comes from the
 * `canonicalSnapshot` + `brandingSnapshot` that were hashed and Ed25519-signed at
 * generate() time. It never reads a live relation, so the rendition can never
 * drift from the signed content (domain invariant: snapshots, not live FKs).
 *
 * The Ed25519 signature is over the canonical JSON (contentHash), NOT over these
 * PDF bytes — the PDF is a human-readable rendition of the signed record, and the
 * footer carries the content hash + signature + public verification URL so a buyer
 * can check the record independently of this file.
 *
 * The layout mirrors the console's BrandedReport component
 * (apps/web/components/inspect/branded-report.tsx) — same sections, order and
 * wording — so what the QA Manager approves on screen is what the buyer receives.
 *
 * Pure: no NestJS, no Prisma, no I/O. Unit-tested in report-pdf.spec.ts.
 */
import { PDFDocument, PDFFont, PDFPage, PageSizes, StandardFonts, rgb } from 'pdf-lib';

// ─────────────────────────── snapshot shapes ───────────────────────────
// Structural, all-optional views of the signed payload. The snapshot is frozen
// JSON from an arbitrarily old schema version, so every field is read defensively:
// a historical report must still render, never throw.

export type SeverityKey = 'critical' | 'major' | 'minor';

interface ClassPlanLike {
  aql?: number | string | null;
  ac?: number | null;
  re?: number | null;
}

interface ClassResultLike {
  found?: number | null;
  ac?: number | null;
  re?: number | null;
  outcome?: string | null;
}

export interface ReportCanonicalSnapshot {
  inspectionId?: string | null;
  inspectionType?: string | null;
  poNumber?: string | null;
  buyer?: { id?: string | null; name?: string | null } | null;
  supplier?: { id?: string | null; name?: string | null } | null;
  product?: {
    id?: string | null;
    styleNumber?: string | null;
    description?: string | null;
  } | null;
  lotSize?: number | null;
  aqlLevel?: string | null;
  aqlPlan?: unknown;
  computedSampling?: {
    sampleSizeCodeLetter?: string | null;
    sampleSize?: number | null;
    perClass?: Partial<Record<SeverityKey, ClassPlanLike>> | null;
  } | null;
  quantity?: {
    cartonsTotal?: number | null;
    cartonsInspected?: number | null;
    quantityPresented?: number | null;
    quantityShortfall?: number | null;
  } | null;
  workmanshipNotes?: string | null;
  packagingNotes?: string | null;
  aqlResult?: {
    perClass?: Partial<Record<SeverityKey, ClassResultLike>> | null;
    systemRecommendation?: string | null;
    qaDecision?: string | null;
    qaRemarks?: string | null;
    decidedByUserId?: string | null;
    decidedAt?: string | null;
  } | null;
  defects?: Array<{
    defectCatalogId?: string | null;
    customText?: string | null;
    severity?: string | null;
    notes?: string | null;
    /** INS-081: the slot the defect was seen on. */
    itemPosition?: number | null;
    cycleIndex?: number | null;
    photoIds?: string[] | null;
  }> | null;
  /** INS-081: the loop's single-image capture points, in order. */
  items?: Array<{
    position?: number | null;
    itemName?: string | null;
    notes?: string | null;
  }> | null;
  /** INS-081: units photographed vs the sampling plan's n. */
  cycles?: { completed?: number | null; sampleSize?: number | null } | null;
  /** INS-081: the loop-global sheet, one set of values per unit. */
  measurements?: Array<{
    cycleIndex?: number | null;
    label?: string | null;
    recordedValue?: string | null;
    unit?: string | null;
  }> | null;
  photoHashes?: string[] | null;
  tamperProof?: unknown;
}

export interface ReportBrandingSnapshot {
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: unknown;
}

export interface ReportPdfInput {
  reportId: string;
  contentHash: string;
  signature: string;
  generatedAt: Date | string;
  /** Public, no-auth verification page (…/r/<verificationToken>). */
  verificationUrl?: string | null;
  canonicalSnapshot: unknown;
  brandingSnapshot?: unknown;
}

// ─────────────────────────── design tokens ───────────────────────────
// Ported from apps/web/components/inspect/tokens.ts — keep in sync by value, not
// by import (the API must not depend on the web app).

const INK = rgb(0x0b / 255, 0x12 / 255, 0x20 / 255);
const SUB = rgb(0x5b / 255, 0x65 / 255, 0x73 / 255);
const FAINT = rgb(0x9a / 255, 0xa3 / 255, 0xae / 255);
const LINE = rgb(0xe5 / 255, 0xe9 / 255, 0xef / 255);
const LINE_SOFT = rgb(0xf0 / 255, 0xf3 / 255, 0xf7 / 255);
const FILL = rgb(0xfa / 255, 0xfb / 255, 0xfc / 255);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0x1f / 255, 0x6b / 255, 0x43 / 255);
const CRITICAL = rgb(0xb4 / 255, 0x23 / 255, 0x18 / 255);
const AMBER = rgb(0xb5 / 255, 0x79 / 255, 0x1a / 255);
const DEFAULT_BRAND = '#1457A3';

const PAGE_W = PageSizes.A4[0];
const PAGE_H = PageSizes.A4[1];
const MARGIN = 44;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = 52;

const SEVERITIES: SeverityKey[] = ['critical', 'major', 'minor'];
const SEVERITY_LABEL: Record<SeverityKey, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
};

// ─────────────────────────── text safety ───────────────────────────

/**
 * The standard PDF fonts are WinAnsi-encoded: a buyer name or free-form QA remark
 * containing CJK/emoji would make pdf-lib THROW mid-render. Report generation must
 * never be able to fail on a stray character, so anything outside CP1252 is folded
 * to an ASCII stand-in.
 */
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function winAnsiSafe(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).replace(/[\r\n\t]+/g, ' ');
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp >= 0xa0 && cp <= 0xff) out += ch;
    else if (CP1252_EXTRAS.has(cp)) out += ch;
    else out += '?';
  }
  return out;
}

function hexToRgb(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  const value = m ? m[1] : DEFAULT_BRAND.slice(1);
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  return parts
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Prisma enum -> readable label: PRE_SHIPMENT -> "Pre shipment" (mirrors the console). */
function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isoDay(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

function num(value: number | null | undefined): string {
  return value == null ? '—' : String(value);
}

// ─────────────────────────── layout engine ───────────────────────────

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

class Painter {
  page!: PDFPage;
  y = 0;
  private readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
    private readonly brand: ReturnType<typeof hexToRgb>,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number): void {
    if (this.y - height < BOTTOM_LIMIT) this.newPage();
  }

  /**
   * Sanitizes before measuring: the standard fonts THROW on an unencodable code
   * point, and measurement happens before drawing — so an un-sanitized width()
   * call is exactly how a stray emoji in a buyer name would kill the render.
   */
  width(text: string, size: number, font: PDFFont): number {
    return font.widthOfTextAtSize(winAnsiSafe(text), size);
  }

  wrap(value: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const text = winAnsiSafe(value);
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.width(candidate, size, font) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    // Hard-break any single token still wider than the column (long hashes/ids).
    return lines.flatMap((line) => this.hardBreak(line, size, font, maxWidth));
  }

  private hardBreak(line: string, size: number, font: PDFFont, maxWidth: number): string[] {
    if (this.width(line, size, font) <= maxWidth) return [line];
    const out: string[] = [];
    let current = '';
    for (const ch of line) {
      if (this.width(current + ch, size, font) > maxWidth && current) {
        out.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) out.push(current);
    return out;
  }

  text(
    value: string,
    opts: {
      x?: number;
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      y?: number;
      align?: 'left' | 'right';
      maxWidth?: number;
    } = {},
  ): void {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.fonts.regular;
    const color = opts.color ?? INK;
    const text = winAnsiSafe(value);
    const x = opts.x ?? MARGIN;
    const y = opts.y ?? this.y;
    const drawX =
      opts.align === 'right' ? x - this.width(text, size, font) : x;
    this.page.drawText(text, { x: drawX, y, size, font, color, maxWidth: opts.maxWidth });
  }

  /** Draw a wrapped paragraph starting at the cursor; advances y. */
  paragraph(
    value: string,
    opts: {
      x?: number;
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
      leading?: number;
    } = {},
  ): void {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.fonts.regular;
    const leading = opts.leading ?? size + 3;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? MARGIN + CONTENT_W - x;
    for (const line of this.wrap(winAnsiSafe(value), size, font, maxWidth)) {
      this.ensure(leading);
      this.text(line, { x, size, font, color: opts.color, y: this.y });
      this.y -= leading;
    }
  }

  rect(x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>): void {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }

  hairline(y: number, color = LINE, x = MARGIN, w = CONTENT_W, thickness = 0.7): void {
    this.page.drawRectangle({ x, y, width: w, height: thickness, color });
  }

  /** "01  SAMPLING PLAN (AQL)" + a 2px brand rule — the BrandedReport section head. */
  section(no: number, title: string, right?: string): void {
    this.ensure(46);
    this.y -= 16;
    this.text(String(no).padStart(2, '0'), {
      x: MARGIN,
      size: 9,
      font: this.fonts.mono,
      color: this.brand,
      y: this.y,
    });
    this.text(title.toUpperCase(), {
      x: MARGIN + 22,
      size: 11,
      font: this.fonts.bold,
      color: INK,
      y: this.y,
    });
    if (right) {
      this.text(right, {
        x: MARGIN + CONTENT_W,
        size: 8.5,
        color: FAINT,
        align: 'right',
        y: this.y,
      });
    }
    this.y -= 7;
    this.hairline(this.y, this.brand, MARGIN, CONTENT_W, 1.6);
    this.y -= 14;
  }

  allPages(): PDFPage[] {
    return this.pages;
  }
}

// ─────────────────────────── the renderer ───────────────────────────

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const snap: ReportCanonicalSnapshot =
    input.canonicalSnapshot && typeof input.canonicalSnapshot === 'object'
      ? (input.canonicalSnapshot as ReportCanonicalSnapshot)
      : {};
  const branding: ReportBrandingSnapshot =
    input.brandingSnapshot && typeof input.brandingSnapshot === 'object'
      ? (input.brandingSnapshot as ReportBrandingSnapshot)
      : {};

  const doc = await PDFDocument.create();
  doc.setTitle(`Inspection report ${reportNo(input.reportId)}`);
  doc.setProducer('Inspect');
  doc.setCreator('Inspect');
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const brand = hexToRgb(branding.primaryColor);
  const p = new Painter(doc, fonts, brand);

  // Sanitize once, at the boundary: every downstream measure/draw then works on
  // text the standard fonts can actually encode.
  const buyerName = winAnsiSafe(snap.buyer?.name).trim() || '—';
  drawHeaderBand(p, fonts, brand, buyerName, input.reportId);
  drawConclusionBand(p, fonts, snap);
  drawMetaGrid(p, fonts, snap, input.generatedAt);
  drawSamplingPlan(p, fonts, snap);
  drawQuantityCheck(p, fonts, snap);
  drawDefectSummary(p, fonts, snap);
  drawDefectNarrative(p, fonts, snap);
  drawPhotoEvidence(p, fonts, snap);
  drawMeasurementSheet(p, fonts, snap);
  drawNotes(p, fonts, snap);
  drawTamperProofFooter(p, fonts, input, buyerName);
  drawPageNumbers(p, fonts, input.reportId);

  // useObjectStreams:false keeps the output a plain, greppable PDF — the
  // integration + unit specs assert on real rendered text, and support can
  // eyeball a stored artifact without tooling.
  return doc.save({ useObjectStreams: false });
}

/** Synthetic, stable display id — there is no reportNo column (documented as synthetic). */
export function reportNo(reportId: string): string {
  return `IR-${(reportId || '').slice(0, 8).toUpperCase()}`;
}

function drawHeaderBand(
  p: Painter,
  fonts: Fonts,
  brand: ReturnType<typeof hexToRgb>,
  buyerName: string,
  reportId: string,
): void {
  const bandH = 88;
  const top = PAGE_H;
  p.rect(0, top - bandH, PAGE_W, bandH, brand);

  const tileSize = 40;
  const tileY = top - 32 - tileSize;
  p.rect(MARGIN, tileY, tileSize, tileSize, rgb(1, 1, 1));
  const ini = initialsOf(buyerName);
  p.text(ini, {
    x: MARGIN + tileSize / 2 - p.width(ini, 14, fonts.bold) / 2,
    y: tileY + tileSize / 2 - 5,
    size: 14,
    font: fonts.bold,
    color: brand,
  });

  p.text(buyerName, {
    x: MARGIN + tileSize + 14,
    y: tileY + 23,
    size: 16,
    font: fonts.bold,
    color: WHITE,
    maxWidth: 300,
  });
  p.text('Quality Inspection Report', {
    x: MARGIN + tileSize + 14,
    y: tileY + 7,
    size: 11,
    color: WHITE,
  });

  p.text('REPORT NO.', {
    x: MARGIN + CONTENT_W,
    y: tileY + 24,
    size: 8.5,
    color: WHITE,
    align: 'right',
  });
  p.text(reportNo(reportId), {
    x: MARGIN + CONTENT_W,
    y: tileY + 7,
    size: 13,
    font: fonts.mono,
    color: WHITE,
    align: 'right',
  });

  p.y = top - bandH - 1;
}

type Conclusion = 'pass' | 'fail' | 'hold' | 'pending';

export function conclusionOf(decision: string | null | undefined): Conclusion {
  if (decision === 'PASS') return 'pass';
  if (decision === 'FAIL') return 'fail';
  if (decision === 'HOLD') return 'hold';
  // No decision recorded — never fabricate a verdict (INS-056).
  return 'pending';
}

function drawConclusionBand(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  const conclusion = conclusionOf(snap.aqlResult?.qaDecision);
  const label =
    conclusion === 'pending'
      ? 'PENDING QA DECISION'
      : conclusion === 'fail'
        ? 'REJECTED'
        : conclusion === 'hold'
          ? 'HOLD'
          : 'ACCEPTED';
  const fg =
    conclusion === 'pending'
      ? SUB
      : conclusion === 'fail'
        ? CRITICAL
        : conclusion === 'hold'
          ? AMBER
          : GREEN;
  const bg =
    conclusion === 'pending'
      ? rgb(0xfa / 255, 0xfb / 255, 0xfc / 255)
      : conclusion === 'fail'
        ? rgb(0xfb / 255, 0xea / 255, 0xea / 255)
        : conclusion === 'hold'
          ? rgb(0xfa / 255, 0xf1 / 255, 0xe2 / 255)
          : rgb(0xea / 255, 0xf6 / 255, 0xf0 / 255);

  const bandH = 54;
  const bandY = p.y - bandH;
  p.rect(0, bandY, PAGE_W, bandH, bg);
  p.hairline(bandY, LINE, 0, PAGE_W, 0.8);

  p.rect(MARGIN, bandY + 15, 24, 24, fg);
  p.text('QA CONCLUSION', {
    x: MARGIN + 36,
    y: bandY + 32,
    size: 8.5,
    font: fonts.bold,
    color: fg,
  });
  p.text(label, { x: MARGIN + 36, y: bandY + 15, size: 16, font: fonts.bold, color: fg });

  const remarks = (snap.aqlResult?.qaRemarks ?? '').trim();
  if (remarks) {
    const lines = p.wrap(winAnsiSafe(remarks), 9, fonts.regular, 220).slice(0, 3);
    let ry = bandY + 34;
    for (const line of lines) {
      p.text(line, { x: MARGIN + CONTENT_W, y: ry, size: 9, color: SUB, align: 'right' });
      ry -= 11;
    }
  }

  const systemRec = snap.aqlResult?.systemRecommendation;
  if (systemRec) {
    p.text(`System recommendation: ${systemRec}`, {
      x: MARGIN + 36,
      y: bandY + 4,
      size: 8,
      color: SUB,
    });
  }

  p.y = bandY - 26;
}

function drawMetaGrid(
  p: Painter,
  fonts: Fonts,
  snap: ReportCanonicalSnapshot,
  generatedAt: Date | string,
): void {
  const pairs: Array<[string, string, boolean]> = [
    ['Purchase order', snap.poNumber || '—', true],
    ['Product', snap.product?.description || snap.product?.styleNumber || '—', false],
    ['Style / SKU', snap.product?.styleNumber || '—', true],
    ['Supplier', snap.supplier?.name || '—', false],
    ['Inspection type', humanizeEnum(snap.inspectionType), false],
    ['AQL level', snap.aqlLevel || '—', true],
    ['Report date', isoDay(generatedAt), true],
    ['Decision recorded', isoDay(snap.aqlResult?.decidedAt), true],
  ];

  const cols = 4;
  const colW = CONTENT_W / cols;
  for (let row = 0; row < Math.ceil(pairs.length / cols); row++) {
    p.ensure(34);
    const labelY = p.y;
    for (let col = 0; col < cols; col++) {
      const pair = pairs[row * cols + col];
      if (!pair) continue;
      const [k, v, isMono] = pair;
      const x = MARGIN + col * colW;
      p.text(k.toUpperCase(), { x, y: labelY, size: 7.5, color: FAINT });
      const font = isMono ? fonts.mono : fonts.regular;
      const line = p.wrap(winAnsiSafe(v), 10, font, colW - 10)[0] ?? '—';
      p.text(line, { x, y: labelY - 13, size: 10, font, color: INK });
    }
    p.y = labelY - 32;
  }
}

function drawSamplingPlan(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  p.section(1, 'Sampling plan (AQL)', 'ANSI/ASQ Z1.4 - single, normal');

  const cs = snap.computedSampling;
  // INS-081: the sample size is a TARGET, not a gate — an inspection may end on
  // any complete unit. Showing both figures keeps a short inspection visible to
  // the buyer instead of silently equivalent to a full one.
  const completed = snap.cycles?.completed;
  const stats: Array<[string, string]> = [
    ['Level', snap.aqlLevel || (cs ? 'II' : '—')],
    ['Code letter', cs?.sampleSizeCodeLetter || '—'],
    ['Lot size', num(snap.lotSize)],
    ['Units / sample', completed != null ? `${completed} / ${num(cs?.sampleSize)}` : num(cs?.sampleSize)],
  ];
  p.ensure(46);
  const boxY = p.y - 36;
  const boxW = (CONTENT_W - 3 * 8) / 4;
  stats.forEach(([k, v], i) => {
    const x = MARGIN + i * (boxW + 8);
    p.rect(x, boxY, boxW, 36, FILL);
    p.hairline(boxY, LINE, x, boxW, 0.6);
    p.hairline(boxY + 36, LINE, x, boxW, 0.6);
    p.text(k.toUpperCase(), { x: x + 8, y: boxY + 23, size: 7.5, color: FAINT });
    p.text(v, { x: x + 8, y: boxY + 8, size: 13, font: fonts.mono, color: INK });
  });
  p.y = boxY - 16;

  // Class | AQL | Found | Ac | Re | Result
  const cols = [MARGIN, MARGIN + 150, MARGIN + 225, MARGIN + 295, MARGIN + 355, MARGIN + CONTENT_W];
  p.ensure(24);
  p.rect(MARGIN, p.y - 6, CONTENT_W, 20, FILL);
  const headY = p.y;
  p.text('CLASS', { x: cols[0] + 6, y: headY, size: 7.5, color: SUB });
  p.text('AQL', { x: cols[1], y: headY, size: 7.5, color: SUB, align: 'right' });
  p.text('FOUND', { x: cols[2], y: headY, size: 7.5, color: SUB, align: 'right' });
  p.text('AC', { x: cols[3], y: headY, size: 7.5, color: SUB, align: 'right' });
  p.text('RE', { x: cols[4], y: headY, size: 7.5, color: SUB, align: 'right' });
  p.text('RESULT', { x: cols[5], y: headY, size: 7.5, color: SUB, align: 'right' });
  p.y -= 20;

  for (const sev of SEVERITIES) {
    const plan = cs?.perClass?.[sev];
    const result = snap.aqlResult?.perClass?.[sev];
    if (!plan && !result) continue;
    p.ensure(22);
    p.hairline(p.y + 12, LINE_SOFT);
    const found = result?.found ?? 0;
    const ac = result?.ac ?? plan?.ac ?? null;
    const re = result?.re ?? plan?.re ?? null;
    const rejected = re != null ? found >= re : false;
    p.text(SEVERITY_LABEL[sev], { x: cols[0] + 6, y: p.y, size: 10, font: fonts.bold, color: INK });
    p.text(plan?.aql != null ? String(plan.aql) : '—', {
      x: cols[1],
      y: p.y,
      size: 9.5,
      font: fonts.mono,
      color: SUB,
      align: 'right',
    });
    p.text(String(found), {
      x: cols[2],
      y: p.y,
      size: 10.5,
      font: fonts.mono,
      color: rejected ? CRITICAL : INK,
      align: 'right',
    });
    p.text(num(ac), { x: cols[3], y: p.y, size: 9.5, font: fonts.mono, color: SUB, align: 'right' });
    p.text(num(re), { x: cols[4], y: p.y, size: 9.5, font: fonts.mono, color: SUB, align: 'right' });
    p.text(result?.outcome === 'FAIL' || rejected ? 'Reject' : 'Accept', {
      x: cols[5],
      y: p.y,
      size: 9.5,
      font: fonts.bold,
      color: result?.outcome === 'FAIL' || rejected ? CRITICAL : GREEN,
      align: 'right',
    });
    p.y -= 20;
  }
}

function drawQuantityCheck(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  p.section(2, 'Quantity & carton check');
  const q = snap.quantity ?? {};
  const rows: Array<[string, string]> = [
    ['Lot size (declared)', snap.lotSize != null ? `${snap.lotSize} pcs` : '—'],
    ['Quantity presented', q.quantityPresented != null ? `${q.quantityPresented} pcs` : '—'],
    ['Quantity shortfall', q.quantityShortfall != null ? `${q.quantityShortfall} pcs` : '—'],
    ['Cartons total', num(q.cartonsTotal)],
    ['Cartons inspected', num(q.cartonsInspected)],
  ];
  for (const [k, v] of rows) {
    p.ensure(18);
    p.text(k, { x: MARGIN, y: p.y, size: 10, color: SUB });
    p.text(v, {
      x: MARGIN + CONTENT_W,
      y: p.y,
      size: 10,
      font: fonts.mono,
      color: INK,
      align: 'right',
    });
    p.y -= 8;
    p.hairline(p.y + 2, LINE_SOFT);
    p.y -= 8;
  }
}

function defectCounts(snap: ReportCanonicalSnapshot): Record<SeverityKey, number> {
  const counts: Record<SeverityKey, number> = { critical: 0, major: 0, minor: 0 };
  for (const d of snap.defects ?? []) {
    const sev = (d.severity ?? '').toLowerCase() as SeverityKey;
    if (sev in counts) counts[sev] += 1;
  }
  return counts;
}

function drawDefectSummary(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  p.section(3, 'Defect summary');
  const counts = defectCounts(snap);
  for (const sev of SEVERITIES) {
    const result = snap.aqlResult?.perClass?.[sev];
    const found = result?.found ?? counts[sev];
    p.ensure(18);
    p.text(SEVERITY_LABEL[sev], { x: MARGIN, y: p.y, size: 10, font: fonts.bold, color: INK });
    p.text(String(found), {
      x: MARGIN + CONTENT_W,
      y: p.y,
      size: 12,
      font: fonts.mono,
      color: (result?.re != null ? found >= result.re : false) ? CRITICAL : INK,
      align: 'right',
    });
    p.y -= 8;
    p.hairline(p.y + 2, LINE_SOFT);
    p.y -= 8;
  }
  p.ensure(14);
  p.text('Defects found within the sample.', { x: MARGIN, y: p.y, size: 8.5, color: FAINT });
  p.y -= 12;
}

function drawDefectNarrative(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  const defects = snap.defects ?? [];
  p.section(4, 'Defect detail', `${defects.length} recorded`);
  if (defects.length === 0) {
    p.paragraph('No defects were recorded during this inspection.', { size: 9.5, color: SUB });
    return;
  }
  // INS-081: the defect carries its slot — (item position, cycle) — and items[]
  // carries the names, so the narrative resolves to "Unit 7 · Right sleeve".
  // (The old zoneByLoopId map was built from loop ids that are not in the signed
  // payload at all, and was never read.)
  const itemNameByPosition = new Map<number, string>();
  (snap.items ?? []).forEach((item, i) => {
    if (item && typeof item === 'object') {
      const position = item.position ?? i + 1;
      itemNameByPosition.set(position, item.itemName || `Item ${position}`);
    }
  });
  const slotLabel = (d: { itemPosition?: number | null; cycleIndex?: number | null }): string => {
    const item = d.itemPosition != null ? itemNameByPosition.get(d.itemPosition) : undefined;
    const unit = d.cycleIndex != null ? `Unit ${d.cycleIndex + 1}` : null;
    return [unit, item].filter(Boolean).join(' · ');
  };

  defects.forEach((d, i) => {
    const sev = (d.severity ?? '').toUpperCase() || 'UNCLASSIFIED';
    // Catalog defects carry only their id inside the signed envelope, so the
    // narrative names custom text verbatim and falls back to the catalog id.
    const title =
      (d.customText ?? '').trim() ||
      (d.defectCatalogId ? `Catalog defect ${d.defectCatalogId}` : 'Unspecified defect');
    p.ensure(26);
    p.text(String(i + 1).padStart(2, '0'), {
      x: MARGIN,
      y: p.y,
      size: 9,
      font: fonts.mono,
      color: FAINT,
    });
    p.text(sev, {
      x: MARGIN + 24,
      y: p.y,
      size: 8.5,
      font: fonts.bold,
      color: sev === 'CRITICAL' ? CRITICAL : sev === 'MAJOR' ? AMBER : SUB,
    });
    const where = slotLabel(d);
    if (where) {
      p.text(where, { x: MARGIN + 90, y: p.y, size: 8.5, color: SUB });
    }
    p.text(`${d.photoIds?.length ?? 0} photo(s)`, {
      x: MARGIN + CONTENT_W,
      y: p.y,
      size: 8.5,
      color: FAINT,
      align: 'right',
    });
    p.y -= 13;
    p.paragraph(title, { x: MARGIN + 24, size: 10, maxWidth: CONTENT_W - 90 });
    if ((d.notes ?? '').trim()) {
      p.paragraph(d.notes!.trim(), {
        x: MARGIN + 24,
        size: 9,
        color: SUB,
        maxWidth: CONTENT_W - 90,
      });
    }
    p.y -= 4;
    p.hairline(p.y + 4, LINE_SOFT);
    p.y -= 6;
  });
}

function drawPhotoEvidence(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  const hashes = snap.photoHashes ?? [];
  p.section(5, 'Photo evidence', `${hashes.length} photo(s)`);
  if (hashes.length === 0) {
    p.paragraph('No photo evidence was captured for this inspection.', { size: 9.5, color: SUB });
    return;
  }
  p.paragraph(
    'The ordered SHA-256 hashes below are part of the signed content hash: the evidence set ' +
      'cannot be reordered, extended or replaced without invalidating this report.',
    { size: 8.5, color: SUB },
  );
  p.y -= 4;
  hashes.forEach((h, i) => {
    p.ensure(14);
    p.text(String(i + 1).padStart(2, '0'), {
      x: MARGIN,
      y: p.y,
      size: 8.5,
      font: fonts.mono,
      color: FAINT,
    });
    p.text(winAnsiSafe(h), { x: MARGIN + 26, y: p.y, size: 8.5, font: fonts.mono, color: SUB });
    p.y -= 12;
  });
}

function drawMeasurementSheet(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  const rows = snap.measurements ?? [];
  if (rows.length === 0) return;

  // INS-081: measurements are recorded once per UNIT (the sheet is loop-global),
  // so the sheet groups by cycleIndex ascending rather than by loop item.
  const byCycle = new Map<number, typeof rows>();
  for (const m of rows) {
    const cycleIndex = m.cycleIndex ?? 0;
    byCycle.set(cycleIndex, [...(byCycle.get(cycleIndex) ?? []), m]);
  }
  const cycles = [...byCycle.keys()].sort((a, b) => a - b);

  p.section(6, 'Measurement sheet', 'Free-form - as recorded, per unit');
  p.ensure(20);
  p.rect(MARGIN, p.y - 6, CONTENT_W, 20, FILL);
  p.text('POINT', { x: MARGIN + 6, y: p.y, size: 7.5, color: SUB });
  p.text('RECORDED', { x: MARGIN + CONTENT_W - 90, y: p.y, size: 7.5, color: SUB, align: 'right' });
  p.text('UNIT', { x: MARGIN + CONTENT_W, y: p.y, size: 7.5, color: SUB, align: 'right' });
  p.y -= 20;

  for (const cycleIndex of cycles) {
    p.ensure(18);
    p.text(`Unit ${cycleIndex + 1}`, {
      x: MARGIN + 6,
      y: p.y,
      size: 9,
      font: fonts.bold,
      color: SUB,
    });
    p.y -= 15;
    for (const m of byCycle.get(cycleIndex) ?? []) {
      p.ensure(18);
      p.hairline(p.y + 11, LINE_SOFT);
      p.text(m.label || '—', { x: MARGIN + 14, y: p.y, size: 9.5, color: INK });
      p.text(m.recordedValue ?? '—', {
        x: MARGIN + CONTENT_W - 90,
        y: p.y,
        size: 9.5,
        font: fonts.mono,
        color: INK,
        align: 'right',
      });
      p.text(m.unit ?? '—', {
        x: MARGIN + CONTENT_W,
        y: p.y,
        size: 9.5,
        font: fonts.mono,
        color: SUB,
        align: 'right',
      });
      p.y -= 15;
    }
  }
}

function drawNotes(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  const workmanship = (snap.workmanshipNotes ?? '').trim();
  const packaging = (snap.packagingNotes ?? '').trim();
  const remarks = (snap.aqlResult?.qaRemarks ?? '').trim();
  if (!workmanship && !packaging && !remarks) return;
  p.section(7, 'Notes & QA decision');
  const blocks: Array<[string, string]> = [
    ['Workmanship notes', workmanship],
    ['Packaging notes', packaging],
    ['QA remarks', remarks],
  ];
  for (const [label, body] of blocks) {
    if (!body) continue;
    p.ensure(26);
    p.text(label.toUpperCase(), { x: MARGIN, y: p.y, size: 7.5, color: FAINT });
    p.y -= 13;
    p.paragraph(body, { size: 9.5, color: INK });
    p.y -= 6;
  }
}

function drawTamperProofFooter(
  p: Painter,
  fonts: Fonts,
  input: ReportPdfInput,
  buyerName: string,
): void {
  p.ensure(140);
  p.y -= 14;
  const boxTop = p.y;
  const boxH = 104;
  const boxY = boxTop - boxH;
  p.rect(MARGIN, boxY, CONTENT_W, boxH, LINE_SOFT);
  p.hairline(boxY, LINE, MARGIN, CONTENT_W, 0.8);
  p.hairline(boxTop, LINE, MARGIN, CONTENT_W, 0.8);

  let y = boxTop - 18;
  p.text('TAMPER-PROOF RECORD', { x: MARGIN + 14, y, size: 8.5, font: fonts.bold, color: SUB });
  p.text('Immutable - v1', {
    x: MARGIN + CONTENT_W - 14,
    y,
    size: 9,
    font: fonts.bold,
    color: INK,
    align: 'right',
  });
  y -= 16;
  p.text('Content hash (SHA-256)', { x: MARGIN + 14, y, size: 7.5, color: FAINT });
  y -= 11;
  p.text(input.contentHash, { x: MARGIN + 14, y, size: 8, font: fonts.mono, color: INK });
  y -= 15;
  p.text('Signature (Ed25519, base64)', { x: MARGIN + 14, y, size: 7.5, color: FAINT });
  y -= 11;
  const sigLines = p.wrap(winAnsiSafe(input.signature), 8, fonts.mono, CONTENT_W - 28);
  for (const line of sigLines.slice(0, 2)) {
    p.text(line, { x: MARGIN + 14, y, size: 8, font: fonts.mono, color: INK });
    y -= 10;
  }
  y -= 3;
  if (input.verificationUrl) {
    p.text('Verify independently at', { x: MARGIN + 14, y, size: 7.5, color: FAINT });
    p.text(input.verificationUrl, {
      x: MARGIN + 120,
      y,
      size: 8,
      font: fonts.mono,
      color: INK,
    });
  }

  p.y = boxY - 18;
  p.ensure(24);
  p.paragraph(
    `Generated by Inspect - ${buyerName} - This report is read-only. Corrections are issued as a new linked re-inspection.`,
    { size: 8, color: FAINT },
  );
  p.paragraph(
    'The Ed25519 signature covers the canonical inspection record (the content hash above), not this PDF file. ' +
      'Anyone can re-verify the record at the URL above without trusting this document.',
    { size: 8, color: FAINT },
  );
}

function drawPageNumbers(p: Painter, fonts: Fonts, reportId: string): void {
  const pages = p.allPages();
  pages.forEach((page, i) => {
    page.drawText(winAnsiSafe(`${reportNo(reportId)}  -  page ${i + 1} of ${pages.length}`), {
      x: MARGIN,
      y: 26,
      size: 7.5,
      font: fonts.mono,
      color: FAINT,
    });
  });
}

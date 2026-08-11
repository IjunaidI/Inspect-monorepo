/**
 * INS-003 — the PDF renderer, as a pure unit spec (no NestJS, no DB, no storage).
 *
 * The guarantee under test: given the FROZEN canonicalSnapshot that was signed,
 * the renderer emits a valid PDF byte stream whose visible text reproduces the
 * signed content — the buyer's document cannot say something the signature does
 * not cover. Text is asserted through extractPdfText (pdf-lib content streams are
 * Flate-compressed hex, so byte-grepping would silently assert nothing).
 */
import { extractPdfText } from './pdf-text';
import {
  conclusionOf,
  renderReportPdf,
  reportNo,
  winAnsiSafe,
  type ReportCanonicalSnapshot,
} from './report-pdf';

const SNAPSHOT: ReportCanonicalSnapshot = {
  inspectionId: 'insp_123',
  inspectionType: 'PRE_SHIPMENT',
  poNumber: 'PO-88421',
  buyer: { id: 'buy_1', name: 'Northwind Apparel' },
  supplier: { id: 'sup_1', name: 'Dhaka Knitwear Ltd' },
  product: { id: 'prod_1', styleNumber: 'NW-7781', description: 'Mens crew tee' },
  lotSize: 3200,
  aqlLevel: 'II',
  computedSampling: {
    sampleSizeCodeLetter: 'L',
    sampleSize: 200,
    perClass: {
      critical: { aql: 0, ac: 0, re: 1 },
      major: { aql: 2.5, ac: 10, re: 11 },
      minor: { aql: 4.0, ac: 14, re: 15 },
    },
  },
  quantity: {
    cartonsTotal: 120,
    cartonsInspected: 12,
    quantityPresented: 3180,
    quantityShortfall: 20,
  },
  workmanshipNotes: 'Stitch density consistent across the run.',
  packagingNotes: 'Polybags per buyer spec; carton marks legible.',
  aqlResult: {
    perClass: {
      critical: { found: 0, ac: 0, re: 1, outcome: 'PASS' },
      major: { found: 3, ac: 10, re: 11, outcome: 'PASS' },
      minor: { found: 9, ac: 14, re: 15, outcome: 'PASS' },
    },
    systemRecommendation: 'PASS',
    qaDecision: 'PASS',
    qaRemarks: 'Accepted with a note on shade variation.',
    decidedByUserId: 'user_9',
    decidedAt: '2026-07-30T10:00:00.000Z',
  },
  defects: [
    {
      defectCatalogId: null,
      customText: 'Loose thread at side seam',
      severity: 'MINOR',
      notes: 'Observed on 4 pieces',
      itemPosition: 1,
      cycleIndex: 0,
      photoIds: ['ph_1', 'ph_2'],
    },
    {
      defectCatalogId: 'cat_skewed_collar',
      customText: null,
      severity: 'MAJOR',
      notes: null,
      itemPosition: 2,
      cycleIndex: 6,
      photoIds: ['ph_3'],
    },
  ],
  items: [
    { position: 1, itemName: 'Front panel', notes: null },
    { position: 2, itemName: 'Collar', notes: null },
  ],
  cycles: { completed: 7, sampleSize: 200 },
  measurements: [
    { cycleIndex: 0, label: 'Chest width', recordedValue: '52.0', unit: 'cm' },
    { cycleIndex: 0, label: 'Body length', recordedValue: '71.5', unit: 'cm' },
    { cycleIndex: 6, label: 'Chest width', recordedValue: '52.4', unit: 'cm' },
  ],
  photoHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
};

const BASE_INPUT = {
  reportId: 'rep_abcdef0123456789',
  contentHash: 'f'.repeat(64),
  signature: 'c2lnbmF0dXJlLWJ5dGVzLWZvci10aGUtdGVzdC1maXh0dXJlLXBhZGRpbmc=',
  generatedAt: new Date('2026-08-01T09:30:00.000Z'),
  verificationUrl: 'https://console.inspect.example/r/tok_verify_123',
  canonicalSnapshot: SNAPSHOT,
  brandingSnapshot: { primaryColor: '#1457A3' },
};

describe('renderReportPdf (INS-003)', () => {
  let bytes: Uint8Array;
  let text: string;

  beforeAll(async () => {
    bytes = await renderReportPdf(BASE_INPUT);
    text = extractPdfText(bytes);
  });

  it('produces a valid PDF byte stream', () => {
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    // Every PDF must terminate with the EOF marker or viewers reject it.
    expect(Buffer.from(bytes).toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('renders the buyer-branded header and the synthetic report number', () => {
    expect(text).toContain('Northwind Apparel');
    expect(text).toContain('Quality Inspection Report');
    expect(text).toContain(reportNo(BASE_INPUT.reportId));
  });

  it('renders the binding QA decision, not the system recommendation, as the conclusion', () => {
    expect(text).toContain('ACCEPTED');
    expect(text).toContain('System recommendation: PASS');
    expect(text).toContain('Accepted with a note on shade variation.');
  });

  it('renders the PO / product / supplier header from the signed snapshot', () => {
    expect(text).toContain('PO-88421');
    expect(text).toContain('NW-7781');
    expect(text).toContain('Dhaka Knitwear Ltd');
    expect(text).toContain('Pre shipment');
  });

  it('renders the AQL sampling plan and the per-class results', () => {
    expect(text).toContain('SAMPLING PLAN');
    expect(text).toContain('ANSI/ASQ Z1.4');
    expect(text).toContain('L'); // code letter
    expect(text).toContain('200'); // sample size
    expect(text).toContain('3200'); // lot size
    expect(text).toContain('Critical');
    expect(text).toContain('Major');
    expect(text).toContain('Minor');
    expect(text).toContain('Accept');
  });

  it('renders the quantity / carton verification', () => {
    expect(text).toContain('QUANTITY');
    expect(text).toContain('3180 pcs');
    expect(text).toContain('20 pcs');
    expect(text).toContain('120');
  });

  it('renders the defect narrative with severities and notes', () => {
    expect(text).toContain('Loose thread at side seam');
    expect(text).toContain('MINOR');
    expect(text).toContain('Observed on 4 pieces');
    expect(text).toContain('MAJOR');
    // A catalog defect carries only its id inside the signed envelope.
    expect(text).toContain('cat_skewed_collar');
  });

  it('renders the ordered photo-evidence hashes that the signature covers', () => {
    expect(text).toContain('PHOTO EVIDENCE');
    expect(text).toContain('a'.repeat(64));
    expect(text).toContain('c'.repeat(64));
  });

  it('renders the measurement sheet', () => {
    expect(text).toContain('MEASUREMENT SHEET');
    expect(text).toContain('Chest width');
    expect(text).toContain('52.0');
    expect(text).toContain('Front panel');
  });

  it('renders the workmanship + packaging notes', () => {
    expect(text).toContain('Stitch density consistent across the run.');
    expect(text).toContain('Polybags per buyer spec');
  });

  it('embeds the content hash, signature and public verification URL in the footer', () => {
    expect(text).toContain('TAMPER-PROOF RECORD');
    expect(text).toContain(BASE_INPUT.contentHash);
    expect(text).toContain(BASE_INPUT.verificationUrl);
    // The signature is base64 and may wrap; assert a distinctive leading run.
    expect(text).toContain(BASE_INPUT.signature.slice(0, 24));
    expect(text).toContain('not this PDF file');
  });

  it('renders REJECTED for a failed QA decision', async () => {
    const failed = await renderReportPdf({
      ...BASE_INPUT,
      canonicalSnapshot: {
        ...SNAPSHOT,
        aqlResult: { ...SNAPSHOT.aqlResult, qaDecision: 'FAIL', qaRemarks: null },
      },
    });
    const out = extractPdfText(failed);
    expect(out).toContain('REJECTED');
    expect(out).not.toContain('ACCEPTED');
  });

  it('never fabricates a verdict when no QA decision was recorded (INS-056)', async () => {
    const pending = await renderReportPdf({
      ...BASE_INPUT,
      canonicalSnapshot: { ...SNAPSHOT, aqlResult: null },
    });
    const out = extractPdfText(pending);
    expect(out).toContain('PENDING QA DECISION');
    expect(out).not.toContain('ACCEPTED');
  });

  it('renders the buyer brand colour without failing on a malformed one', async () => {
    await expect(
      renderReportPdf({ ...BASE_INPUT, brandingSnapshot: { primaryColor: 'not-a-colour' } }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('survives non-WinAnsi text instead of throwing mid-render', async () => {
    const exotic = await renderReportPdf({
      ...BASE_INPUT,
      canonicalSnapshot: {
        ...SNAPSHOT,
        buyer: { id: 'b', name: '深圳 Buyer 🎉 Co' },
        workmanshipNotes: 'Δοκιμή — smart “quotes” and an em—dash',
      },
    });
    expect(Buffer.from(exotic.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(extractPdfText(exotic)).toContain('Buyer');
  });

  it('renders an empty/legacy snapshot without throwing', async () => {
    const minimal = await renderReportPdf({
      ...BASE_INPUT,
      canonicalSnapshot: {},
      brandingSnapshot: undefined,
    });
    expect(Buffer.from(minimal.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const out = extractPdfText(minimal);
    expect(out).toContain('PENDING QA DECISION');
    expect(out).toContain('No defects were recorded');
  });

  it('paginates a large inspection instead of overflowing one page', async () => {
    const many = await renderReportPdf({
      ...BASE_INPUT,
      canonicalSnapshot: {
        ...SNAPSHOT,
        defects: Array.from({ length: 40 }, (_, i) => ({
          customText: `Defect number ${i} on the sampled unit`,
          severity: 'MINOR',
          notes: 'Recorded during the guided photo loop',
          photoIds: ['p1'],
        })),
      },
    });
    const out = extractPdfText(many);
    expect(out).toContain('page 1 of');
    expect(out).toContain('page 2 of');
    expect(out).toContain('Defect number 39');
    // The tamper-proof footer must survive pagination — it is the whole point.
    expect(out).toContain('TAMPER-PROOF RECORD');
  });
});

describe('report-pdf helpers', () => {
  it('conclusionOf maps the binding decision, defaulting to pending', () => {
    expect(conclusionOf('PASS')).toBe('pass');
    expect(conclusionOf('FAIL')).toBe('fail');
    expect(conclusionOf('HOLD')).toBe('hold');
    expect(conclusionOf(null)).toBe('pending');
    expect(conclusionOf('WHATEVER')).toBe('pending');
  });

  it('winAnsiSafe folds unencodable characters instead of throwing', () => {
    expect(winAnsiSafe('plain ASCII')).toBe('plain ASCII');
    expect(winAnsiSafe('café')).toBe('café');
    expect(winAnsiSafe('em—dash')).toBe('em—dash'); // CP1252 keeps the em dash
    expect(winAnsiSafe('深圳')).toBe('??');
    expect(winAnsiSafe('line\nbreak')).toBe('line break');
    expect(winAnsiSafe(null)).toBe('');
  });

  it('reportNo is a stable, uppercase synthetic display id', () => {
    expect(reportNo('rep_abcdef0123456789')).toBe('IR-REP_ABCD');
    expect(reportNo('')).toBe('IR-');
  });
});

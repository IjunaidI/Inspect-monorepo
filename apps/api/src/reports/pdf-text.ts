/**
 * Text extraction for the PDFs this API produces (INS-003).
 *
 * pdf-lib writes Flate-compressed content streams whose show-text operands are
 * WinAnsi hex strings (`<5175616C…> Tj`), so a rendered report cannot be verified
 * by grepping the raw bytes. This decoder is what lets the unit + integration
 * specs assert on the ACTUAL rendered wording ("did the buyer's PDF really say
 * REJECTED?") instead of merely asserting the file is a PDF.
 *
 * Deliberately narrow: it understands the operators this renderer emits, nothing
 * more. It is not a general-purpose PDF text extractor.
 */
import { inflateSync } from 'node:zlib';

const STREAM = Buffer.from('stream', 'latin1');
const ENDSTREAM = Buffer.from('endstream', 'latin1');

export function extractPdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const parts: string[] = [];
  let idx = 0;
  while ((idx = buf.indexOf(STREAM, idx)) !== -1) {
    let start = idx + STREAM.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf(ENDSTREAM, start);
    if (end === -1) break;
    const raw = buf.subarray(start, end);
    try {
      parts.push(inflateSync(raw).toString('latin1'));
    } catch {
      parts.push(raw.toString('latin1'));
    }
    idx = end + ENDSTREAM.length;
  }

  const content = parts.join('\n');
  const showText = /<([0-9A-Fa-f]+)>\s*Tj/g;
  const lines: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = showText.exec(content)) !== null) {
    lines.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  return lines.join('\n');
}

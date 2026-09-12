/**
 * The GLOBAL capture-point library (INS-097) — what a pre-shipment garment
 * inspection photographs, per category, with each description written as the
 * capture INSTRUCTION the inspector reads on the camera screen.
 *
 * Sources: QIMA pre-shipment inspection guides, the Tetra Inspection textile
 * checklist, the QC Advisor apparel checklist, Textile Learner / Designers
 * Nexus points of measure. Points of measure (chest, inseam, rise…) are NOT
 * capture points — they belong on the loop-global measurement sheet.
 *
 * Kept in its own module (no Prisma import) so `seed.ts` can seed it and a Jest
 * spec can pin `LOOP_TEMPLATES` in `@inspect/domain` against it without running
 * the seed. `iconKey` values are `IconName`s from `@inspect/design-tokens`.
 */
import type { IconName } from '@inspect/design-tokens';
import type { CapturePointCategory } from '@inspect/shared-types';

export interface GlobalCapturePointSeed {
  name: string;
  category: CapturePointCategory;
  description: string;
  iconKey: IconName;
}

export const GLOBAL_CAPTURE_POINTS: readonly GlobalCapturePointSeed[] = [
  // ── OVERALL ─────────────────────────────────────────────────────────────────
  {
    name: 'Front flat-lay',
    category: 'OVERALL',
    iconKey: 'tshirtOutline',
    description:
      'Lay flat on a plain surface, closures fastened; shoot straight down with the whole garment in frame.',
  },
  {
    name: 'Back flat-lay',
    category: 'OVERALL',
    iconKey: 'tshirtOutline',
    description:
      'Flip and re-square the garment; same distance and framing as the front.',
  },
  {
    name: 'Left side',
    category: 'OVERALL',
    iconKey: 'tshirtOutline',
    description:
      'Garment on its left side or on a form, side seam centred; full length in frame.',
  },
  {
    name: 'Right side',
    category: 'OVERALL',
    iconKey: 'tshirtOutline',
    description:
      'Garment on its right side or on a form, side seam centred; full length in frame.',
  },
  {
    name: 'Inside-out front',
    category: 'OVERALL',
    iconKey: 'tshirtOutline',
    description:
      'Turn inside out and lay flat; seam allowances and overlocking across the front.',
  },
  {
    name: 'Inside-out back',
    category: 'OVERALL',
    iconKey: 'tshirtOutline',
    description:
      'Inside out, back up; seam allowances, overlocking and the label stitching from behind.',
  },

  // ── TOP ─────────────────────────────────────────────────────────────────────
  {
    name: 'Collar & neckline',
    category: 'TOP',
    iconKey: 'collar',
    description:
      'Collar fastened and standing; frame shoulder to shoulder so both collar points show.',
  },
  {
    name: 'Neck hole inside',
    category: 'TOP',
    iconKey: 'neckhole',
    description:
      'Open the neck and shoot down into it: neck tape, back-neck seam and label stitching.',
  },
  {
    name: 'Left sleeve',
    category: 'TOP',
    iconKey: 'sleeve',
    description:
      "Sleeve laid straight from shoulder seam to cuff, wearer's left, seam facing up.",
  },
  {
    name: 'Right sleeve',
    category: 'TOP',
    iconKey: 'sleeve',
    description:
      "Sleeve laid straight from shoulder seam to cuff, wearer's right, seam facing up.",
  },
  {
    name: 'Left cuff',
    category: 'TOP',
    iconKey: 'cuff',
    description:
      'Cuff flat and closed; fill the frame so placket, button and stitching are legible.',
  },
  {
    name: 'Right cuff',
    category: 'TOP',
    iconKey: 'cuff',
    description:
      'Cuff flat and closed; fill the frame so placket, button and stitching are legible.',
  },
  {
    name: 'Shoulder seam',
    category: 'TOP',
    iconKey: 'shoulder',
    description:
      'One shoulder seam end to end, garment flat, with the armhole join visible.',
  },
  {
    name: 'Front placket',
    category: 'TOP',
    iconKey: 'placket',
    description:
      'Placket flat and buttoned; buttons, buttonholes and both stitch lines in one frame.',
  },
  {
    name: 'Chest pocket',
    category: 'TOP',
    iconKey: 'pocket',
    description:
      'Pocket square-on; opening, bartacks and alignment to the placket visible.',
  },
  {
    name: 'Hem',
    category: 'TOP',
    iconKey: 'hem',
    description:
      'Bottom hem flat across the full width; the hem stitch line and any side slit visible.',
  },
  {
    name: 'Side seam',
    category: 'TOP',
    iconKey: 'seam',
    description: 'Side seam laid straight from armhole to hem.',
  },
  {
    name: 'Back yoke',
    category: 'TOP',
    iconKey: 'yoke',
    description:
      'Back yoke seam across the shoulders, garment flat and squared.',
  },
  {
    name: 'Print / embroidery',
    category: 'TOP',
    iconKey: 'print',
    description:
      'Artwork square-on and filling the frame; include a garment edge for scale.',
  },

  // ── BOTTOM ──────────────────────────────────────────────────────────────────
  {
    name: 'Waistband',
    category: 'BOTTOM',
    iconKey: 'waistband',
    description:
      'Waistband flat and closed, straight across; belt loops and the inner label edge in frame.',
  },
  {
    name: 'Belt loops',
    category: 'BOTTOM',
    iconKey: 'waistband',
    description: 'One belt loop close-up; bartacks top and bottom.',
  },
  {
    name: 'Fly / zipper top',
    category: 'BOTTOM',
    iconKey: 'zipper',
    description:
      'Fly closed; frame the zipper top stop, fly button and bartack.',
  },
  {
    name: 'Zipper open',
    category: 'BOTTOM',
    iconKey: 'zipper',
    description:
      'Fly open; slider, teeth and fly shield visible along the full length.',
  },
  {
    name: 'Fly button',
    category: 'BOTTOM',
    iconKey: 'placket',
    description: 'Fly button and buttonhole close-up, fastened.',
  },
  {
    name: 'Front left pocket',
    category: 'BOTTOM',
    iconKey: 'pocket',
    description: 'Pocket opening flat; bag edge and bartacks visible.',
  },
  {
    name: 'Front right pocket',
    category: 'BOTTOM',
    iconKey: 'pocket',
    description: 'Pocket opening flat; bag edge and bartacks visible.',
  },
  {
    name: 'Back left pocket',
    category: 'BOTTOM',
    iconKey: 'pocket',
    description:
      'Pocket square-on; placement relative to the yoke seam and side seam.',
  },
  {
    name: 'Back right pocket',
    category: 'BOTTOM',
    iconKey: 'pocket',
    description:
      'Pocket square-on; placement relative to the yoke seam and side seam.',
  },
  {
    name: 'Coin pocket',
    category: 'BOTTOM',
    iconKey: 'pocket',
    description: 'Coin pocket and its rivets, square-on.',
  },
  {
    name: 'Crotch seam',
    category: 'BOTTOM',
    iconKey: 'seam',
    description:
      'Legs opened; the four-seam junction centred and fully visible.',
  },
  {
    name: 'Inseam',
    category: 'BOTTOM',
    iconKey: 'seam',
    description: 'Inner leg seam laid straight from crotch to hem.',
  },
  {
    name: 'Outseam',
    category: 'BOTTOM',
    iconKey: 'seam',
    description: 'Outer leg seam laid straight from waistband to hem.',
  },
  {
    name: 'Leg hem',
    category: 'BOTTOM',
    iconKey: 'hem',
    description: 'One leg opening flat; hem stitch and hem width visible.',
  },
  {
    name: 'Rivets & hardware',
    category: 'BOTTOM',
    iconKey: 'tagOutline',
    description: 'Rivets, shank buttons and hardware close-up; logos legible.',
  },

  // ── LABELS_TRIMS ────────────────────────────────────────────────────────────
  {
    name: 'Main label',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description:
      'Straight-on, filling the frame, text legible; include the stitching on every attached edge.',
  },
  {
    name: 'Size label',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description:
      'Size label straight-on; size and any secondary size codes readable.',
  },
  {
    name: 'Care label',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description:
      'Unfold fully; every symbol and language panel readable in one shot.',
  },
  {
    name: 'Fibre content label',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description: 'Fibre composition panel straight-on, percentages legible.',
  },
  {
    name: 'Country-of-origin label',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description: 'Origin marking straight-on and legible.',
  },
  {
    name: 'Hangtag front',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description: 'Hangtag front square-on; string attachment point in frame.',
  },
  {
    name: 'Hangtag back',
    category: 'LABELS_TRIMS',
    iconKey: 'tagOutline',
    description: 'Hangtag back square-on; price / barcode area legible.',
  },
  {
    name: 'Barcode sticker',
    category: 'LABELS_TRIMS',
    iconKey: 'qr',
    description: 'Square-on, no glare; digits and bars both readable.',
  },

  // ── PACKAGING ───────────────────────────────────────────────────────────────
  {
    name: 'Polybag',
    category: 'PACKAGING',
    iconKey: 'polybag',
    description:
      'Garment bagged; warning print and vent holes visible, seal closed.',
  },
  {
    name: 'Folded presentation',
    category: 'PACKAGING',
    iconKey: 'boxOutline',
    description:
      'Folded garment as packed, top-down; fold lines and any tissue or insert visible.',
  },
  {
    name: 'Inner carton',
    category: 'PACKAGING',
    iconKey: 'boxOutline',
    description:
      'Inner carton open from above; contents and packing arrangement visible.',
  },
  {
    name: 'Outer carton',
    category: 'PACKAGING',
    iconKey: 'boxOutline',
    description:
      'Closed outer carton with three faces visible; corners and tape condition.',
  },
  {
    name: 'Shipping mark',
    category: 'PACKAGING',
    iconKey: 'boxOutline',
    description:
      'Carton side with the full shipping mark square-on and legible.',
  },
  {
    name: 'Carton label',
    category: 'PACKAGING',
    iconKey: 'qr',
    description: 'Carton label and barcode square-on, readable.',
  },

  // ── TEST ────────────────────────────────────────────────────────────────────
  {
    name: 'Measurement setup',
    category: 'TEST',
    iconKey: 'rulerOutline',
    description:
      'Garment flat with the tape laid along the measured line; the tape reading must be legible.',
  },
  {
    name: 'Colour vs swatch',
    category: 'TEST',
    iconKey: 'palette',
    description:
      'Approved swatch placed on the garment under the same light; shoot both in one frame.',
  },
  {
    name: 'Rub test cloth',
    category: 'TEST',
    iconKey: 'palette',
    description:
      'The crock-test cloth beside the tested area after the rub test.',
  },
  {
    name: 'Button pull',
    category: 'TEST',
    iconKey: 'testTube',
    description: 'Button under the pull gauge with the force reading visible.',
  },
  {
    name: 'Zipper cycle',
    category: 'TEST',
    iconKey: 'zipper',
    description:
      'Zipper after the cycle count, mid-run; slider and teeth visible.',
  },
  {
    name: 'Needle detector',
    category: 'TEST',
    iconKey: 'scannerOutline',
    description:
      'Garment passing through the detector with the indicator in frame.',
  },
  {
    name: 'GSM scale',
    category: 'TEST',
    iconKey: 'testTube',
    description: 'Cut swatch on the scale with the reading legible.',
  },
];

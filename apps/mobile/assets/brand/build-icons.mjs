/**
 * Regenerates the app icon, Android adaptive-icon layers and the splash mark
 * in the v2 palette (INS-095): forest green `#3A7D44` with the collar glyph
 * from the design tokens, cream `#FDFCF8` splash. A placeholder brand mark —
 * swap `MARK` for the real logo path when one exists.
 *
 *   node apps/mobile/assets/brand/build-icons.mjs
 *
 * Uses the workspace's `sharp` (a transitive dependency); no new package.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// here = apps/mobile/assets/brand → four levels up is the repo root.
const sharp = require(resolve(here, '../../../../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp'));

const GREEN = '#3A7D44';
const CREAM = '#FDFCF8';
const WHITE = '#FFFFFF';

/** The collar glyph (24-box) from packages/design-tokens/src/icons.ts. */
const MARK = '<path d="M4 4C7 2.8 17 2.8 20 4"/><path d="M4 4L10 13L12 8L14 13L20 4"/><path d="M12 8V21.5"/>';

function svg({ size, bg, fg, scale, strokeWidth = 1.6, radius = 0 }) {
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : ''}
  <g transform="translate(${offset} ${offset}) scale(${glyph / 24})" fill="none" stroke="${fg}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${MARK}</g>
</svg>`);
}

const out = (name) => join(here, '..', 'images', name);

await sharp(svg({ size: 1024, bg: GREEN, fg: WHITE, scale: 0.56 })).png().toFile(out('icon.png'));
await sharp(svg({ size: 1024, bg: null, fg: WHITE, scale: 0.42 })).png().toFile(out('android-icon-foreground.png'));
await sharp(svg({ size: 1024, bg: GREEN, fg: GREEN, scale: 0.01 })).png().toFile(out('android-icon-background.png'));
await sharp(svg({ size: 1024, bg: null, fg: WHITE, scale: 0.42 })).png().toFile(out('android-icon-monochrome.png'));
await sharp(svg({ size: 304, bg: null, fg: GREEN, scale: 0.9, strokeWidth: 1.5 })).png().toFile(out('splash-icon.png'));
await sharp(svg({ size: 48, bg: GREEN, fg: WHITE, scale: 0.6, radius: 10 })).png().toFile(out('favicon.png'));
console.log(`wrote icon.png, android-icon-{foreground,background,monochrome}.png, splash-icon.png, favicon.png (${GREEN} / ${CREAM})`);

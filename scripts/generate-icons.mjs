// Renders the Folio app icon (an original gold notepad on navy) to every size the PWA needs.
// Run with `npm run icons`. Output is committed, so this only needs re-running if the design changes.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** The notepad artwork, drawn on a 1024×1024 canvas centred at (512, 512). */
const notepad = `
  <path d="M336 252 H688 A44 44 0 0 1 732 296 V682 L622 792 H336 A44 44 0 0 1 292 748 V296 A44 44 0 0 1 336 252 Z" fill="url(#gold)"/>
  <path d="M622 792 V716 A34 34 0 0 1 656 682 H732 Z" fill="#b5802a"/>
  <rect x="362" y="404" width="300" height="34" rx="17" fill="#0e1a33" opacity="0.92"/>
  <rect x="362" y="484" width="300" height="34" rx="17" fill="#0e1a33" opacity="0.92"/>
  <rect x="362" y="564" width="300" height="34" rx="17" fill="#0e1a33" opacity="0.92"/>
  <rect x="362" y="644" width="180" height="34" rx="17" fill="#0e1a33" opacity="0.92"/>
  ${[377, 467, 557, 647]
    .map(
      (x) => `<circle cx="${x}" cy="306" r="17" fill="#0e1a33"/>
  <rect x="${x - 14}" y="206" width="28" height="104" rx="14" fill="url(#ring)"/>`,
    )
    .join('\n  ')}
`;

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#182c55"/>
      <stop offset="1" stop-color="#0a1222"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f3ca70"/>
      <stop offset="1" stop-color="#d69c36"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbe7b8"/>
      <stop offset="1" stop-color="#e0b25a"/>
    </linearGradient>
  </defs>`;

/**
 * @param {{ rounded: boolean, scale: number }} opts
 *   rounded: rounded-square background (favicon / "any" icons) vs full bleed (iOS / maskable)
 *   scale: artwork scale; maskable icons keep the art inside the 80% safe zone
 */
function iconSvg({ rounded, scale }) {
  const offset = 512 - 512 * scale;
  const bg = rounded
    ? '<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>'
    : '<rect width="1024" height="1024" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}
  ${bg}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${notepad}</g>
</svg>`;
}

function png(svg, size, file) {
  const out = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  console.log(`  ${file.replace(root, 'public')}  ${size}×${size}`);
}

const rounded = iconSvg({ rounded: true, scale: 1 });
const fullBleed = iconSvg({ rounded: false, scale: 1 });
const maskable = iconSvg({ rounded: false, scale: 0.78 });

writeFileSync(join(root, 'favicon.svg'), rounded);
console.log('  public/favicon.svg');
png(rounded, 32, join(root, 'icons', 'favicon-32.png'));
png(rounded, 192, join(root, 'icons', 'icon-192.png'));
png(rounded, 512, join(root, 'icons', 'icon-512.png'));
png(maskable, 192, join(root, 'icons', 'maskable-192.png'));
png(maskable, 512, join(root, 'icons', 'maskable-512.png'));
png(fullBleed, 180, join(root, 'apple-touch-icon.png'));

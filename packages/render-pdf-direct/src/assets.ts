/**
 * The two third-party byte assets every pdf-direct artifact embeds (see
 * ../THIRD-PARTY-ASSETS.md for provenance + licences): the DejaVu Sans TTF
 * pair (PDF/A-2b requires every font embedded — the Stage 0 spike's
 * `StandardFonts.Helvetica` was the known violation, docs/STANDARDS.md) and
 * the sRGB2014 ICC profile for the OutputIntent. Read from disk once per
 * process and cached; the renderer is in-process and hot (ADR-002's whole
 * reason for keeping it), so a 1.4 MB font read per document would be a
 * real cost.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export interface PdfDirectAssets {
  regularTtf: Uint8Array;
  boldTtf: Uint8Array;
  sRgbIcc: Uint8Array;
}

let cached: PdfDirectAssets | undefined;

export function loadAssets(): PdfDirectAssets {
  if (cached === undefined) {
    cached = {
      regularTtf: new Uint8Array(readFileSync(join(ASSETS_DIR, 'dejavu', 'DejaVuSans.ttf'))),
      boldTtf: new Uint8Array(readFileSync(join(ASSETS_DIR, 'dejavu', 'DejaVuSans-Bold.ttf'))),
      sRgbIcc: new Uint8Array(readFileSync(join(ASSETS_DIR, 'icc', 'sRGB2014.icc'))),
    };
  }
  return cached;
}

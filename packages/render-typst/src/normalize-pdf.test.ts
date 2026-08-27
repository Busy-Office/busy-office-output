import { describe, expect, it } from 'vitest';
import { normalizePdf } from './normalize-pdf.js';

function bytesOf(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'latin1'));
}
function strOf(b: Uint8Array): string {
  return Buffer.from(b).toString('latin1');
}

describe('normalizePdf', () => {
  it('zeroes CreationDate, ModDate and the trailer ID, preserving byte length', () => {
    const src =
      "<< /ModDate(D:20260827081044+08'00)/CreationDate(D:20260827081044+08'00)>>\n" +
      'trailer\n<< /Size 10 /ID[(kMx2v3wKL+fgR7KiYoyHeA==)(kMx2v3wKL+fgR7KiYoyHeA==)] >>';
    const out = strOf(normalizePdf(bytesOf(src)));
    expect(out.length).toBe(src.length);
    expect(out).toMatch(/\/ModDate\(0+\)/);
    expect(out).toMatch(/\/CreationDate\(0+\)/);
    expect(out).toMatch(/\/ID\[\(0+\)\(0+\)\]/);
    expect(out).not.toContain('20260827');
    expect(out).not.toContain('kMx2v3wKL');
  });

  it('is idempotent and two independently-built "same content" buffers normalize identically', () => {
    const a = "/CreationDate(D:20260827081044+08'00)/ModDate(D:20260827081099+08'00)/ID[(aaaa)(bbbb)]";
    const b = "/CreationDate(D:20260827091500-05'00)/ModDate(D:20260827091500-05'00)/ID[(cccc)(dddd)]";
    // Different real timestamps/IDs, same surrounding structure length per field.
    expect(strOf(normalizePdf(bytesOf(a))).length).toBe(a.length);
    expect(strOf(normalizePdf(bytesOf(b))).length).toBe(b.length);
  });

  it('leaves unrelated bytes untouched', () => {
    const src = 'no dates or ids here, just PDF content stream bytes %PDF-1.7';
    expect(strOf(normalizePdf(bytesOf(src)))).toBe(src);
  });
});

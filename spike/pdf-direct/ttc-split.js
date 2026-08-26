const fs = require('fs');

// Minimal TTC -> standalone SFNT extractor. Copies the target face's table
// directory verbatim (tables may be shared across faces in the collection;
// that's fine, we just copy bytes). No re-subsetting: full glyph set kept.
function extractFace(ttcPath, faceIndex) {
  const buf = fs.readFileSync(ttcPath);
  if (buf.toString('latin1', 0, 4) !== 'ttcf') throw new Error('not a ttc');
  const numFonts = buf.readUInt32BE(8);
  if (faceIndex >= numFonts) throw new Error('face index out of range');
  const sfntOffset = buf.readUInt32BE(12 + faceIndex * 4);

  const sfntVersion = buf.readUInt32BE(sfntOffset);
  const numTables = buf.readUInt16BE(sfntOffset + 4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = sfntOffset + 12 + i * 16;
    tables.push({
      tag: buf.toString('latin1', rec, rec + 4),
      checksum: buf.readUInt32BE(rec + 4),
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }

  // Build new file: 12-byte header + 16-byte-per-table directory, then tables.
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = Math.pow(2, entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const headerSize = 12 + numTables * 16;
  let cursor = headerSize;
  const chunks = [];
  const dirEntries = [];
  for (const t of tables) {
    const padded = (t.length + 3) & ~3; // 4-byte align
    const raw = buf.slice(t.offset, t.offset + t.length);
    const padding = Buffer.alloc(padded - t.length);
    chunks.push(raw, padding);
    dirEntries.push({ ...t, newOffset: cursor });
    cursor += padded;
  }

  const out = Buffer.alloc(headerSize);
  out.writeUInt32BE(sfntVersion, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(rangeShift, 10);
  dirEntries.forEach((t, i) => {
    const rec = 12 + i * 16;
    out.write(t.tag, rec, 'latin1');
    out.writeUInt32BE(t.checksum, rec + 4);
    out.writeUInt32BE(t.newOffset, rec + 8);
    out.writeUInt32BE(t.length, rec + 12);
  });

  return Buffer.concat([out, ...chunks]);
}

module.exports = { extractFace };

if (require.main === module) {
  const [ttcPath, idx, outPath] = process.argv.slice(2);
  const bytes = extractFace(ttcPath, Number(idx));
  fs.writeFileSync(outPath, bytes);
  console.log('wrote', outPath, bytes.length, 'bytes');
}

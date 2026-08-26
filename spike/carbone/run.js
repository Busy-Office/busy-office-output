#!/usr/bin/env node
/**
 * Spike A — Carbone (office-template path, ADR-000 Path B).
 * PREREQUISITE: LibreOffice installed (see Carbone README for the tested version),
 * and po-template.odt authored per TEMPLATE.md in this directory.
 *
 *   npm install && node run.js --bench
 *
 * Measures ms/doc with the LibreOffice worker pool WARM — cold start excluded,
 * matching how Carbone reports its own ~50ms/doc figure.
 */
const fs = require('node:fs');
const path = require('node:path');
const carbone = require('carbone');
const { bench } = require('../bench');

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'reference-po-120-lines.json'), 'utf8'),
);
const template = path.join(__dirname, 'po-template.odt');
if (!fs.existsSync(template)) {
  console.error('po-template.odt not found — author it first, see TEMPLATE.md');
  process.exit(1);
}

carbone.set({ factories: 3, startFactory: true }); // 3 LibreOffice workers

const renderOnce = () =>
  new Promise((resolve, reject) =>
    carbone.render(template, data, { convertTo: 'pdf' }, (err, result) =>
      err ? reject(err) : resolve(result),
    ),
  );

(async () => {
  const first = await renderOnce(); // cold start, not measured
  fs.writeFileSync(path.join(__dirname, 'out.pdf'), first);
  console.log(`out.pdf written (${(first.length / 1024).toFixed(0)} KB) — inspect pagination by eye:`);
  console.log('  [ ] column header repeats on every page');
  console.log('  [ ] totals block not split across pages');
  console.log('  [ ] long descriptions wrap, no clipping');
  if (process.argv.includes('--bench')) await bench('carbone + LibreOffice pdf', renderOnce);
  process.exit(0); // kills LO workers
})().catch((e) => { console.error(e); process.exit(1); });

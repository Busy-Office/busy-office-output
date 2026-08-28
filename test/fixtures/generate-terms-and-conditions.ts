/**
 * One-off generator for `test/fixtures/terms-and-conditions.pdf`
 * (ROADMAP Stage 4, "PDF attachment concatenation"). Run manually
 * (`npx tsx test/fixtures/generate-terms-and-conditions.ts`) whenever the
 * fixture needs regenerating — its OUTPUT is what's checked into git, not
 * this script's regeneration on every test run, so the fixture stays
 * byte-stable across unrelated test runs/CI machines.
 *
 * PLACEHOLDER CONTENT — not real legal terms and conditions. Two pages of
 * clearly-labeled filler text, purely to exercise page-merge with a
 * multi-page, independently-PDF/A-2b-compliant source (real T&C content is
 * out of scope: this proves the mechanism, not a legal document).
 * Rendered via the same TypstRenderer + DocNode path every other template
 * uses (no bespoke PDF construction), so the fixture is guaranteed
 * PDF/A-2b compliant by construction.
 */
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypstRenderer } from '@busy-office/render-typst';
import type { DataContractEnvelope, DocNode } from '@busy-office/output-schema';

const termsAndConditionsTemplate: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [
    {
      kind: 'header',
      children: [{ kind: 'text', value: 'header.title', style: 'title' }],
    },
    { kind: 'text', value: 'header.notice' },
    { kind: 'text', value: 'header.body1' },
    { kind: 'text', value: 'header.body2' },
    { kind: 'text', value: 'header.body3' },
    { kind: 'text', value: 'header.body4' },
    { kind: 'text', value: 'header.body5' },
    { kind: 'text', value: 'header.body6' },
    { kind: 'text', value: 'header.body7' },
    { kind: 'text', value: 'header.body8' },
    { kind: 'text', value: 'header.body9' },
    { kind: 'text', value: 'header.body10' },
    { kind: 'text', value: 'header.body11' },
    { kind: 'text', value: 'header.body12' },
    { kind: 'text', value: 'header.body13' },
    { kind: 'text', value: 'header.body14' },
    { kind: 'text', value: 'header.body15' },
    { kind: 'text', value: 'header.body16' },
    { kind: 'text', value: 'header.body17' },
    { kind: 'text', value: 'header.body18' },
    { kind: 'text', value: 'header.body19' },
    { kind: 'text', value: 'header.body20' },
  ],
};

function fillerParagraph(n: number): string {
  return `${n}. [PLACEHOLDER FIXTURE — NOT REAL LEGAL CONTENT] This is filler paragraph number ${n} of a static test fixture used only to exercise PDF page-merge mechanics (test/fixtures/terms-and-conditions.pdf). It repeats generic prose long enough to spill onto a second page under A4/40pt-margin layout, proving multi-page source concatenation, but carries no legal meaning whatsoever.`;
}

function buildData(): DataContractEnvelope<Record<string, string>> {
  const header: Record<string, string> = {
    title: 'Terms and Conditions (placeholder fixture)',
    notice: 'This document is a static test fixture, not real legal content.',
  };
  for (let i = 1; i <= 20; i++) {
    header[`body${i}`] = fillerParagraph(i);
  }
  return { schemaVersion: '1.0.0', documentType: 'terms-and-conditions-fixture', header };
}

async function main(): Promise<void> {
  const renderer = new TypstRenderer();
  const artifact = await renderer.render({
    kind: 'ir',
    ir: { irVersion: '1', root: termsAndConditionsTemplate, data: buildData() },
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, 'terms-and-conditions.pdf');
  await writeFile(outPath, artifact.bytes);
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} (${artifact.bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { expect } from 'vitest';
import { verifyPdfA } from '@busy-office/render-typst';

/**
 * ADR-006 / docs/STANDARDS.md Tier 2: "PDF/A-2b ... veraPDF in the corpus
 * gates". Shells out to the real `verapdf` CLI (packages/render-typst/src
 * /verify-pdfa.ts) and fails the test loudly, with the validator's actual
 * findings, if the artifact is not PDF/A-2b compliant — never a silent
 * "assume it's fine".
 */
export async function assertPdfA(pdfBytes: Uint8Array): Promise<void> {
  const result = await verifyPdfA(pdfBytes, '2b');
  if (!result.compliant) {
    const findings = result.failures
      .map((f) => `  - [${f.ruleId ?? '?'}] ${f.description ?? ''}: ${f.errorMessage ?? ''}`)
      .join('\n');
    expect.fail(
      `PDF/A-2b validation failed (${result.failedRules} rule(s), ${result.passedRules} passed):\n${findings}`,
    );
  }
  expect(result.compliant).toBe(true);
}

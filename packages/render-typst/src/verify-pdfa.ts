/**
 * veraPDF PDF/A validation helper (ADR-006, docs/STANDARDS.md Tier 2:
 * "PDF/A-2b ... veraPDF in the corpus gates"). Shells out to the `verapdf`
 * CLI (same shape as the `typst` shell-out in renderer.ts — no npm binding)
 * against a PDF byte buffer and returns a clean pass/fail with the
 * validator's actual findings on failure. Never assumes compliance: a
 * validator process that fails to run at all (missing binary, crash,
 * unparsable output) is itself reported as a failure, not swallowed into a
 * silent pass.
 *
 * Invocation: `verapdf -f 2b --format json <file>` — `-f 2b` pins the
 * PDF/A-2b validation profile explicitly (rather than relying on
 * auto-detection from the file's own XMP conformance claim), so this check
 * verifies the file actually meets 2b, not merely that it claims to.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type PdfaFlavour = '1a' | '1b' | '2a' | '2b' | '2u' | '3a' | '3b' | '3u';

export interface PdfaRuleFailure {
  clause?: string;
  testNumber?: string;
  ruleId?: string;
  description?: string;
  errorMessage?: string;
}

export interface PdfaValidationResult {
  compliant: boolean;
  flavour: PdfaFlavour;
  passedRules: number;
  failedRules: number;
  /** Populated when compliant is false: the validator's actual findings. */
  failures: PdfaRuleFailure[];
  /** Raw veraPDF JSON report, for callers that want more than the summary above. */
  raw: unknown;
}

export class VeraPdfError extends Error {}

/**
 * Validates `pdfBytes` against the given PDF/A flavour (default `2b`,
 * matching this project's archive profile) using the `verapdf` binary on
 * PATH. Throws VeraPdfError if the validator process itself cannot be run
 * or its output cannot be parsed — this is deliberately NOT reported as
 * `compliant: false`, since that would conflate "we don't know" with
 * "we checked and it fails".
 */
export async function verifyPdfA(
  pdfBytes: Uint8Array,
  flavour: PdfaFlavour = '2b',
  opts: { verapdfBin?: string } = {},
): Promise<PdfaValidationResult> {
  const bin = opts.verapdfBin ?? 'verapdf';
  const dir = await mkdtemp(join(tmpdir(), 'bo-verapdf-'));
  const pdfPath = join(dir, 'doc.pdf');
  try {
    await writeFile(pdfPath, pdfBytes);

    const result = await run(bin, ['-f', flavour, '--format', 'json', pdfPath]);
    // veraPDF exits non-zero for a non-compliant PDF (that's expected and
    // still a valid report to parse), but 0 output / a crash is not.
    if (result.stdout.trim().length === 0) {
      throw new VeraPdfError(
        `verapdf produced no output (exit ${result.code}). stderr:\n${result.stderr}`,
      );
    }

    let report: unknown;
    try {
      report = JSON.parse(result.stdout);
    } catch (err) {
      throw new VeraPdfError(
        `failed to parse verapdf JSON output: ${(err as Error).message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    return summarize(report, flavour);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function summarize(report: unknown, flavour: PdfaFlavour): PdfaValidationResult {
  const job = (report as any)?.report?.jobs?.[0];
  const validationResult = job?.validationResult?.[0];
  if (!validationResult) {
    throw new VeraPdfError(
      `verapdf JSON report has no validationResult — job may have failed to parse the PDF:\n${JSON.stringify(report, null, 2)}`,
    );
  }

  const details = validationResult.details ?? {};
  const compliant: boolean = validationResult.compliant === true;
  const failures: PdfaRuleFailure[] = [];

  // Actual veraPDF 1.30 JSON shape (confirmed empirically, not guessed from
  // docs): each entry in `ruleSummaries` carries `clause`/`testNumber` at
  // the top level (not nested under a `ruleId` object) plus a `checks[]`
  // array whose entries carry the human-readable `errorMessage`.
  const ruleSummaries: unknown[] = details.ruleSummaries ?? [];
  for (const rs of ruleSummaries) {
    const r = rs as any;
    if ((r.failedChecks ?? 0) > 0 || r.ruleStatus === 'FAILED' || r.status === 'failed') {
      failures.push({
        clause: r.clause,
        testNumber: r.testNumber !== undefined ? String(r.testNumber) : undefined,
        ruleId: r.clause !== undefined && r.testNumber !== undefined ? `${r.clause}-${r.testNumber}` : undefined,
        description: r.description,
        errorMessage: (r.checks?.[0]?.errorMessage as string | undefined) ?? r.errorMessage,
      });
    }
  }

  return {
    compliant,
    flavour,
    passedRules: details.passedRules ?? 0,
    failedRules: details.failedRules ?? 0,
    failures,
    raw: report,
  };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err) => reject(new VeraPdfError(`failed to spawn '${bin}': ${err.message}`)));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

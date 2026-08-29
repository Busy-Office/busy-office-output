/**
 * GAP-10 DoD (ROADMAP): "a payslip email test asserts subject + body
 * rendered from a template (not a hardcoded string), varying by locale;
 * body never contains a value not in the template's expressions".
 *
 * Drives the REAL pipeline (`createRuntimeDeps` → `emit` → composition →
 * SQLite delivery queue → `drainOnce` with the real `EmailChannelSender`
 * over a fake transporter — no network) and then proves, for en-US and
 * de-DE:
 *  (a) the subject/body the transporter received came from the REGISTERED
 *      message template: the expected text is RECONSTRUCTED from that
 *      template's own segments (literals verbatim, expressions evaluated
 *      with the same evaluator) — nothing in this test hardcodes wording;
 *  (b) the evaluated `header.employeeName` / `header.payPeriodEnd` are in it;
 *  (c) NO other payload value is: every non-literal substring equals an
 *      evaluated template expression (the reconstruction is that proof,
 *      byte for byte), and as a belt-and-braces check every PII value the
 *      payload carries OUTSIDE the template's expressions (employee id,
 *      payslip number, every amount) is absent.
 * Then: a locale with no message template (fr-FR — the built-in has no
 * wildcard fallback) fails determination with
 * `unresolved-message-template`, carrying the TRACE, and NOTHING is
 * minted or enqueued. And the trace never carries the rendered text.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataContractEnvelope } from '@busy-office/output-schema';
import { evaluateExpression } from '@busy-office/render-typst';
import { createRuntimeDeps, type RuntimeDeps } from '../index.js';
import { EmailChannelSender, type TransporterLike } from '../delivery/email-channel-sender.js';
import { messageTemplateExpressions, type MessageTemplate } from '../message/message-template.js';
import { drainOnce } from '../worker.js';
import { generatePayslip } from '../../../../test/corpus/payslip/generate.js';
import type { PayslipData } from '@busy-office/output-schema';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

interface SentMail {
  to: string[];
  subject: string;
  text: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}

function fakeTransporter(): { transporter: TransporterLike; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const transporter: TransporterLike = {
    sendMail: (async (message: SentMail) => {
      sent.push(message);
      return { messageId: 'fake' };
    }) as unknown as TransporterLike['sendMail'],
  };
  return { transporter, sent };
}

function realDeps(): RuntimeDeps {
  const root = tempDir('payslip-email-');
  return createRuntimeDeps(join(root, 'registry.db'), join(root, 'archive'), join(root, 'outbox'));
}

/** The "allowed set": every template expression, evaluated. */
function allowedValues(template: MessageTemplate, data: DataContractEnvelope): Map<string, string> {
  const out = new Map<string, string>();
  for (const expr of messageTemplateExpressions(template)) out.set(expr, String(evaluateExpression(expr, data)));
  return out;
}

/** Reconstruct the text purely from the template's segments + the allowed
 * set — literal segments verbatim, expression segments by name. */
function reconstruct(segments: MessageTemplate['subject'], allowed: Map<string, string>): string {
  return segments.map((s) => (typeof s === 'string' ? s : allowed.get(s.expr)!)).join('');
}

/** Payload PII that is NOT among the template's expressions — must never
 * appear in the rendered text. */
function disallowedNeedles(data: PayslipData, allowed: Map<string, string>): string[] {
  const candidates = [
    data.header.employeeId,
    data.header.payslipNumber,
    data.header.employer.name,
    String(data.totals.grossPay.amount),
    String(data.totals.totalDeductions.amount),
    String(data.totals.netPay.amount),
    ...data.lines.map((l) => String(l.amount.amount)),
    ...data.lines.map((l) => l.description),
  ];
  const allowedText = [...allowed.values()];
  return candidates.filter((c) => !allowedText.some((a) => a.includes(c)));
}

async function emitAndDrain(locale: string, seed: number) {
  const deps = realDeps();
  const { transporter, sent } = fakeTransporter();
  const sender = new EmailChannelSender({ from: 'payroll@example.com', transporter });
  const data = generatePayslip({ seed, earningCount: 2, deductionCount: 2 });
  const recipients = [`emp-${seed}@example.com`];
  try {
    const result = await deps.output.emit({
      documentType: 'payslip',
      payload: data,
      businessEvent: { businessObject: 'PAYROLL', businessObjectId: `PS-MSG-${locale}-${seed}`, event: 'payslip.issued', templateVersion: '1.0.0' },
      determination: { locale, recipients },
    });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('unreachable');
    const email = result.resolutions.find((r) => r.channel === 'email');
    expect(email?.composition).toMatchObject({ outcome: 'rendered' });
    expect(email?.messageTemplateId).toBeDefined();
    const template = deps.documentTypes.messageTemplate(email!.messageTemplateId!);
    expect(template).toBeDefined();
    expect(template!.meta.variant.locale).toBe(locale);
    expect(template!.meta.lifecycle).toBe('published');
    expect(template!.meta.provenance).toBe('human');

    // The trace names the template by ID and never carries rendered text.
    const trace = JSON.stringify(deps.registryStore.getTraceLog(result.resolutions[0].docId));
    expect(trace).toContain(email!.messageTemplateId);
    expect(trace).not.toContain(data.header.employeeName);
    expect(trace).not.toContain(recipients[0]);

    const drained = await drainOnce(deps.deliveryQueue, sender);
    const emailAttempt = drained.find((d) => d.job.channel === 'email');
    expect(emailAttempt?.outcome).toBe('delivered');
    expect(sent).toHaveLength(1);
    return { data: data as unknown as DataContractEnvelope, payslip: data, template: template!, mail: sent[0], recipients };
  } finally {
    deps.deliveryQueue.close();
    deps.registryStore.close();
  }
}

describe('GAP-10: payslip email subject/body are rendered from a lifecycle-governed template, per locale', () => {
  for (const locale of ['en-US', 'de-DE'] as const) {
    it(`${locale}: subject + body equal the registered template's literals + evaluated expressions, and nothing else`, async () => {
      const { data, payslip, template, mail, recipients } = await emitAndDrain(locale, locale === 'en-US' ? 42 : 43);
      const allowed = allowedValues(template, data);

      expect(mail.to).toEqual(recipients);
      expect(mail.attachments).toHaveLength(1);

      // (a)+(c): byte-for-byte reconstruction from the template — every
      // literal is verbatim, every non-literal substring is an evaluated
      // expression from the template's own allowed set.
      expect(mail.subject).toBe(reconstruct(template.subject, allowed));
      expect(mail.text).toBe(reconstruct(template.body, allowed));
      for (const segment of [...template.subject, ...template.body]) {
        if (typeof segment === 'string') expect(mail.subject + mail.text).toContain(segment);
      }

      // (b): the evaluated values named by the template are present.
      expect(allowed.get('header.employeeName')).toBe(payslip.header.employeeName);
      expect(allowed.get('header.payPeriodEnd')).toBe(payslip.header.payPeriodEnd);
      expect(mail.text).toContain(payslip.header.employeeName);
      expect(mail.subject).toContain(payslip.header.payPeriodEnd);

      // (c) belt-and-braces: payload PII outside the allowed set is absent.
      const disallowed = disallowedNeedles(payslip, allowed);
      expect(disallowed.length).toBeGreaterThan(3);
      for (const needle of disallowed) {
        expect(mail.subject, `subject leaks "${needle}"`).not.toContain(needle);
        expect(mail.text, `body leaks "${needle}"`).not.toContain(needle);
      }
    }, 60_000);
  }

  it('en-US and de-DE wording differ (varying by locale is real, not a relabel)', async () => {
    const en = await emitAndDrain('en-US', 44);
    const de = await emitAndDrain('de-DE', 45);
    expect(en.template.meta.id).not.toBe(de.template.meta.id);
    const literals = (t: MessageTemplate) => [...t.subject, ...t.body].filter((s): s is string => typeof s === 'string');
    expect(literals(en.template)).not.toEqual(literals(de.template));
    expect(en.mail.subject).not.toBe(de.mail.subject);
    // Same expressions, different words: the allowed set is locale-invariant.
    expect(messageTemplateExpressions(en.template)).toEqual(messageTemplateExpressions(de.template));
  }, 60_000);

  it('a locale with no message template (fr-FR, no wildcard fallback) fails determination loudly: unresolved-message-template with TRACE, nothing minted, nothing enqueued', async () => {
    const deps = realDeps();
    const data = generatePayslip({ seed: 46, earningCount: 1, deductionCount: 1 });
    const businessEvent = { businessObject: 'PAYROLL', businessObjectId: 'PS-MSG-fr-FR', event: 'payslip.issued', templateVersion: '1.0.0' };
    try {
      const result = await deps.output.emit({
        documentType: 'payslip',
        payload: data,
        businessEvent,
        determination: { locale: 'fr-FR', recipients: ['emp-46@example.com'] },
      });
      expect(result.status).toBe('unresolved-message-template');
      if (result.status !== 'unresolved-message-template') throw new Error('unreachable');
      expect(result.trace.outcome).toBe('unresolved-message-template');
      const emailTrace = result.trace.resolutions.find((r) => r.ruleId === 'payslip-default-email');
      // The DOCUMENT template resolved; only the message half is missing.
      expect(emailTrace).toMatchObject({ winningTemplateId: 'payslip-global-v1', recipientsSource: 'context' });
      expect(emailTrace?.winningMessageTemplateId).toBeUndefined();
      // Every registered message candidate is in the trace (same discipline
      // as document templates: "why didn't this ALSO match" is answerable);
      // none matched, and the two payslip ones missed on locale precisely.
      const candidates = emailTrace!.messageTemplates!;
      expect(candidates.every((c) => !c.matched)).toBe(true);
      const payslipCandidates = candidates.filter((c) => c.templateId.startsWith('payslip-email-'));
      expect(payslipCandidates.map((c) => c.templateId).sort()).toEqual(['payslip-email-de-DE-v1', 'payslip-email-en-US-v1']);
      for (const candidate of payslipCandidates) {
        expect(candidate.reasons.join('\n')).toMatch(/locale: candidate requires ".*", query has "fr-FR" — no match/);
      }
      // Nothing minted, nothing enqueued; trace persisted, PII-free.
      expect(deps.registryStore.listByEventKey(businessEvent)).toEqual([]);
      expect(deps.deliveryQueue.listJobs({ limit: 10, offset: 0 })).toEqual([]);
      expect(JSON.stringify(result.trace)).not.toContain(data.header.employeeName);
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  }, 30_000);
});

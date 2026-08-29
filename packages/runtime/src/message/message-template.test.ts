/**
 * Message-template module (GAP-10): registration-time structural check and
 * enqueue-time evaluation. Locale resolution itself is exercised end-to-end
 * in embed/payslip-email-message.test.ts; this file pins the two
 * module-local contracts: a bad expression is rejected at registration,
 * and evaluation fails by expression NAME, never by value.
 */
import { describe, expect, it } from 'vitest';
import type { DataContractEnvelope } from '@busy-office/output-schema';
import { createDocumentTypeRegistry } from '../registration/document-type-registry.js';
import { checkMessageTemplate, messageTemplateExpressions, renderMessage, type MessageTemplate } from './message-template.js';

const template: MessageTemplate = {
  meta: { id: 'memo-email-v1', variant: { documentType: 'memo', locale: 'en-US' }, version: '1.0.0', lifecycle: 'published', provenance: 'human' },
  channel: 'email',
  subject: ['Memo ', { expr: 'header.memoNumber' }],
  body: ['Hello ', { expr: 'header.to' }, ', memo ', { expr: 'header.memoNumber' }, ' is attached.'],
};

const envelope = {
  schemaVersion: '1.0.0',
  documentType: 'memo',
  header: { memoNumber: 'M-1', to: 'Ada', nested: { x: 1 } },
  lines: [],
  totals: {},
} as unknown as DataContractEnvelope;

describe('message template (GAP-10)', () => {
  it('lists each expression once, subject first', () => {
    expect(messageTemplateExpressions(template)).toEqual(['header.memoNumber', 'header.to']);
  });

  it('renders literals verbatim and expressions by evaluation', () => {
    expect(renderMessage(template, envelope)).toEqual({ subject: 'Memo M-1', body: 'Hello Ada, memo M-1 is attached.' });
  });

  it('a non-scalar expression fails by NAME, never by value', () => {
    const bad: MessageTemplate = { ...template, body: ['x ', { expr: 'header.nested' }] };
    expect(() => renderMessage(bad, envelope)).toThrow(/expression "header.nested" did not evaluate to a scalar/);
    const missing: MessageTemplate = { ...template, body: ['x ', { expr: 'header.absent' }] };
    expect(() => renderMessage(missing, envelope)).toThrow(/"header.absent"/);
  });

  it('checkMessageTemplate rejects an expression outside the frozen grammar, an empty part, and a non-email channel', () => {
    const problems = checkMessageTemplate(
      { ...template, channel: 'sms' as 'email', subject: [], body: ['a', { expr: 'header.x[0]' }, { expr: 'nope.root' }] },
      'messageTemplates[0]',
    );
    expect(problems.map((p) => p.path)).toEqual([
      'messageTemplates[0].channel',
      'messageTemplates[0].subject',
      'messageTemplates[0].body[1].expr',
      'messageTemplates[0].body[2].expr',
    ]);
    expect(checkMessageTemplate(template, 'p')).toEqual([]);
  });

  it('registration is atomic: a definition with a bad message template registers nothing', () => {
    const registry = createDocumentTypeRegistry();
    const contract = { $id: 'https://example.test/memo.schema.json', type: 'object' };
    const rules = [{ id: 'r', conditions: { documentType: 'memo' }, resolution: { channel: 'email' } }];
    const bad = registry.register({
      documentType: 'memo',
      contract,
      templates: [],
      rules,
      messageTemplates: [{ ...template, body: [{ expr: 'header.x[0]' }] }],
    });
    expect(bad.status).toBe('invalid');
    expect(registry.has('memo')).toBe(false);
    expect(registry.messageTemplateMetas()).toEqual([]);

    const good = registry.register({ documentType: 'memo', contract, templates: [], rules, messageTemplates: [template] });
    expect(good).toMatchObject({ status: 'registered', templateIds: [], messageTemplateIds: ['memo-email-v1'] });
    expect(registry.messageTemplate('memo-email-v1')).toBe(template);
    // Message templates share the id namespace with document templates.
    const clash = registry.register({ documentType: 'memo2', contract: { ...contract, $id: 'https://example.test/memo2.schema.json' }, templates: [], rules: [], messageTemplates: [{ ...template, meta: { ...template.meta, variant: { documentType: 'memo2' } } }] });
    expect(clash).toMatchObject({ status: 'invalid', problems: [{ path: 'messageTemplates[0].meta.id' }] });
  });
});

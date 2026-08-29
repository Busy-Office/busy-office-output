/**
 * The three built-in document types, as `DocumentTypeDefinition`s ready
 * for `OutputPort.registerDocumentType` (GAP-08). Imported by exactly one
 * engine file — the composition root, `src/index.ts` — which registers
 * them in this order at startup. No other `src/**` file may import this
 * directory (`src/registration/engine-boundary.test.ts`).
 *
 * Order matters and is deliberate: invoice, payslip, purchase-order is
 * the alphabetical filename order the old module-level rule cache
 * evaluated `rules/output-rules/*.json` in, so `determine()`'s trace lists
 * rules in the same sequence it always did.
 */
import type { DocumentTypeDefinition } from '../src/registration/document-type-definition.js';
import { invoice } from './invoice.js';
import { payslip } from './payslip.js';
import { purchaseOrder } from './purchase-order.js';

export { invoice, payslip, purchaseOrder };

export const builtinDocumentTypes: readonly DocumentTypeDefinition[] = [invoice, payslip, purchaseOrder];

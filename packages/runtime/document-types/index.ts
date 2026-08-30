/**
 * The three built-in document types, as `DocumentTypeDefinition`s ready
 * for `OutputPort.registerDocumentType` (GAP-08). Imported by exactly one
 * engine file — the composition root, `src/index.ts` — which registers
 * them in this order at startup. No other `src/**` file may import this
 * directory (`src/registration/engine-boundary.test.ts`).
 *
 * This directory is a reference/example consumer of the engine's public
 * registration seam, not the engine itself: the engine (`src/**`) is
 * document-type-blind by construction, enforced by the same boundary
 * test. A real ERP registers its own document types through the
 * identical public verb, exactly as `test/document-types/sample-memo/`
 * does from outside this tree. The package-boundary question (should
 * this move to its own npm package) is deferred, not undecided — see
 * ADR-007's Must-not-build list.
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

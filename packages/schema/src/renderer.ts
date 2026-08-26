/**
 * The renderer interface (HLD §6), widened so BOTH ADR-000 paths implement it:
 *  - Path A renderers consume a LayoutIR
 *  - Path B (Carbone) consumes a template ref + raw data
 * Renderer selection is a property of the TEMPLATE, never a global setting.
 * The registry records renderer id+version on every DocumentInstance.
 */
import type { LayoutIR } from './ir/layout-ir.js';
import type { DataContractEnvelope } from './contract/data-contract.js';

export type RenderJob =
  | { kind: 'ir'; ir: LayoutIR }                                        // Path A
  | { kind: 'office-template'; templateRef: string; data: DataContractEnvelope }; // Path B

export interface Artifact { mediaType: string; bytes: Uint8Array }

export interface Renderer {
  readonly id: string;          // "typst" | "pdf-direct" | "carbone" | ...
  readonly version: string;     // pinned; recorded in the document registry
  readonly accepts: RenderJob['kind'][];
  render(job: RenderJob, opts?: { locale?: string }): Promise<Artifact>;
}

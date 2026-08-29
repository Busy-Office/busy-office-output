/**
 * Cover-sheet generator (ROADMAP Stage 4, "PDF attachment concatenation").
 *
 * Deliberately minimal — this proves the page-merge mechanism
 * (packages/render-typst's mergePdfs, docs/STANDARDS.md's PDF/A-2b
 * guarantee holding across a merge), not a real cover-sheet product. One
 * `document` root, a `header` with a title, and one identifying line of
 * text: "Cover sheet for <docId>". Any real cover-sheet content (recipient
 * block, delivery instructions, letterhead...) is future product work, not
 * this task's scope.
 *
 * Reuses the same `DocNode` + `TypstRenderer` path every other template in
 * this codebase renders through (registered document-type templates) — no second
 * rendering mechanism, no bespoke Typst markup. The one field the cover
 * sheet needs (`docId`) is passed as ordinary bound data, exactly like any
 * other template's fields (packages/schema/src/document/nodes.ts's frozen
 * nine node kinds; docs/EXPRESSION-GRAMMAR.md's `header.*` expression
 * syntax) — not a special case in the renderer.
 */
import type { DataContractEnvelope, DocNode, Renderer } from '@busy-office/output-schema';

export const COVER_SHEET_DOC_TYPE = 'cover-sheet';

export const coverSheetTemplate: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [
    {
      kind: 'header',
      children: [{ kind: 'text', value: 'header.title', style: 'title' }],
    },
    { kind: 'text', value: 'header.subtitle' },
  ],
};

export interface CoverSheetHeader {
  title: string;
  subtitle: string;
}

/** Builds the bound data envelope for `coverSheetTemplate` for one docId. */
export function coverSheetData(docId: string): DataContractEnvelope<CoverSheetHeader> {
  return {
    schemaVersion: '1.0.0',
    documentType: COVER_SHEET_DOC_TYPE,
    header: {
      title: `Cover sheet for ${docId}`,
      subtitle: 'Generated automatically — attachments follow.',
    },
  };
}

/** Renders a one-page cover sheet PDF identifying `docId`, via the given Renderer. */
export async function renderCoverSheet(renderer: Renderer, docId: string): Promise<Uint8Array> {
  const artifact = await renderer.render({
    kind: 'ir',
    ir: { irVersion: '1', root: coverSheetTemplate, data: coverSheetData(docId) },
  });
  return artifact.bytes;
}

/**
 * `parentId` content-merge (docs/VARIANT-RESOLUTION.md "parentId
 * inheritance"; scoped by the GAP-27 ruling, docs/GAP-REGISTER.md). Pure
 * functions only — no I/O, matching resolve.ts's style. This is the
 * function that was specified at Stage 1 and never built anywhere
 * through four stage closures (GAP-27); it now runs from
 * `DocumentTypeRegistry.templateContent` (packages/runtime), not just
 * here as a standalone utility.
 *
 * The frozen `DocNode` kinds (nodes.ts, ADR-000) give stable per-node
 * addressing ONLY inside `fieldGrid.fields[].label`, `table.columns[].key`,
 * and `totals.rows[].label` — so those three are the only kinds this
 * module merges. `section`/`document`/`header`/`footer`'s `children`
 * arrays carry no stable per-item identity: inventing one (an index, or a
 * "first child of this kind" heuristic across an array with more than one
 * candidate) is exactly the gold-plating the ruling forbids. A layer
 * whose own content IS a `fieldGrid`/`table`/`totals` node is merged into
 * the ONE node of that kind already present in the tree so far (throwing
 * if the tree doesn't have exactly one — never guessing which of several
 * candidates was meant); a layer whose content is any other kind
 * (`document`/`section`/`header`/`footer`/`text`/`pageNumber`) is a
 * whole-subtree override — it replaces everything merged so far, no
 * partial splice, exactly as docs/GAP-REGISTER.md's GAP-27 ruling states.
 *
 * This is also what makes "zero template forking" real: an override
 * layer's registered `content` is a tiny, standalone fragment — literally
 * `{ kind: 'totals', rows: [...] }` for a totals-row override — never a
 * second copy of the whole document tree.
 */
import type { DocNode } from '../document/nodes.js';

const MERGEABLE_KINDS = ['fieldGrid', 'table', 'totals'] as const;
type MergeableKind = (typeof MERGEABLE_KINDS)[number];

function isMergeableKind(kind: DocNode['kind']): kind is MergeableKind {
  return (MERGEABLE_KINDS as readonly string[]).includes(kind);
}

/** Child-wins merge of two label/key-addressed arrays. Parent items the
 * child doesn't mention pass through unchanged; parent items the child
 * also declares are replaced by the child's version, in the parent's
 * original position; any child-only item (a genuine addition, not an
 * override) is appended. */
function mergeByKey<K extends string, T extends Record<K, string>>(parentItems: readonly T[], childItems: readonly T[], key: K): T[] {
  const childByKey = new Map(childItems.map((item) => [item[key], item]));
  const parentKeys = new Set(parentItems.map((item) => item[key]));
  const merged = parentItems.map((item) => childByKey.get(item[key]) ?? item);
  for (const item of childItems) {
    if (!parentKeys.has(item[key])) merged.push(item);
  }
  return merged;
}

function mergeMergeableNode(base: Extract<DocNode, { kind: MergeableKind }>, layer: Extract<DocNode, { kind: MergeableKind }>): DocNode {
  switch (layer.kind) {
    case 'fieldGrid':
      if (base.kind !== 'fieldGrid') throw new Error(`variant override kind mismatch: layer is "fieldGrid", target node is "${base.kind}"`);
      return { ...base, fields: mergeByKey(base.fields, layer.fields, 'label') };
    case 'table':
      if (base.kind !== 'table') throw new Error(`variant override kind mismatch: layer is "table", target node is "${base.kind}"`);
      return { ...base, columns: mergeByKey(base.columns, layer.columns, 'key') };
    case 'totals':
      if (base.kind !== 'totals') throw new Error(`variant override kind mismatch: layer is "totals", target node is "${base.kind}"`);
      return { ...base, rows: mergeByKey(base.rows, layer.rows, 'label') };
  }
}

/**
 * Applies `mergeIntoTarget` to the single node of `kind` found by walking
 * `tree` (only descending into `document`/`section`/`header`/`footer`
 * children — the whole-subtree containers; never re-ordering or
 * filtering them). Returns the count of matches found alongside the
 * (possibly unchanged) tree so the caller can throw on 0 or >1 rather
 * than silently picking one.
 */
function mergeUniqueKindInTree(
  tree: DocNode,
  kind: MergeableKind,
  mergeIntoTarget: (target: Extract<DocNode, { kind: MergeableKind }>) => DocNode,
): { tree: DocNode; matches: number } {
  if (tree.kind === kind) {
    return { tree: mergeIntoTarget(tree as Extract<DocNode, { kind: MergeableKind }>), matches: 1 };
  }
  switch (tree.kind) {
    case 'document':
    case 'section':
    case 'header':
    case 'footer': {
      let matches = 0;
      const children = tree.children.map((child) => {
        const result = mergeUniqueKindInTree(child, kind, mergeIntoTarget);
        matches += result.matches;
        return result.tree;
      });
      return { tree: { ...tree, children }, matches };
    }
    default:
      return { tree, matches: 0 };
  }
}

/**
 * Folds a `parentId` chain — most-specific-first, `resolveParentChain`'s
 * own order — into one merged `DocNode` tree. `chain[chain.length - 1]`
 * (the root) must carry a complete tree; every more-specific layer above
 * it may be a complete tree of its own (a whole-subtree override — the
 * usual "wildcard" template shape) or a small fragment whose root node is
 * `fieldGrid`/`table`/`totals` (a genuine partial override — the
 * "zero forking" shape this task exists to prove).
 *
 * Throws when a `fieldGrid`/`table`/`totals` layer doesn't match exactly
 * one node of that kind in the tree merged so far — ambiguous or absent
 * targets are an error here, never a silent no-op or a guess (the same
 * "trace, never silent" discipline as rule evaluation).
 */
export function mergeTemplateContent(chain: readonly DocNode[]): DocNode {
  if (chain.length === 0) throw new Error('mergeTemplateContent requires a non-empty chain');
  let merged = chain[chain.length - 1];
  for (let i = chain.length - 2; i >= 0; i--) {
    const layer = chain[i];
    if (isMergeableKind(layer.kind)) {
      const mergeableLayer = layer as Extract<DocNode, { kind: MergeableKind }>;
      const { tree, matches } = mergeUniqueKindInTree(merged, mergeableLayer.kind, (target) => mergeMergeableNode(target, mergeableLayer));
      if (matches !== 1) {
        throw new Error(
          `variant override layer of kind "${layer.kind}" must match exactly one node of that kind in the parent chain's merged tree so far; found ${matches}`,
        );
      }
      merged = tree;
    } else {
      // Whole-subtree override (docs/GAP-REGISTER.md GAP-27 ruling): this
      // layer's own kind ('document' | 'section' | 'header' | 'footer' |
      // 'text' | 'pageNumber') carries no addressable per-item identity —
      // it fully replaces everything merged so far, no partial splice.
      merged = layer;
    }
  }
  return merged;
}

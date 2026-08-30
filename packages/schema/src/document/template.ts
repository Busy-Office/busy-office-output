/**
 * Variant identity and lifecycle. SURVIVES BOTH ADR-000 PATHS:
 * Path B changes what `body` points at (an .odt archiveRef instead of a
 * node tree) but not how templates are keyed, resolved, or governed.
 * Locale is part of the key on day one — see docs/VARIANT-RESOLUTION.md.
 */
export interface VariantKey {
  documentType: string;
  companyCode?: string;         // "*" when absent
  country?: string;
  partnerId?: string;
  locale?: string;              // BCP-47
}

export type TemplateLifecycle = 'draft' | 'review' | 'approved' | 'published' | 'retired';

export interface TemplateMeta {
  id: string;
  variant: VariantKey;
  version: string;              // immutable once published
  parentId?: string;            // inheritance chain (most-specific-match wins)
  lifecycle: TemplateLifecycle; // DECLARED INITIAL state only: seeded once into the runtime's
                                // persisted lifecycle log on registration; after that the log is the
                                // state and this field is ignored. Only `published` is a live candidate.
  renderer: string;             // renderer id this template targets (per-template, not global)
  provenance?: 'human' | 'ai-generated' | 'ai-assisted'; // ADR-005: AI output faces the same gates
}

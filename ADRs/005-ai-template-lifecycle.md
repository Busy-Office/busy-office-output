# ADR-005 — AI-native template lifecycle

**Status:** Proposed — closes when Stage 7 is entered (skill-first tasks in
Stages 2 and 4 proceed regardless; they are cheap and self-verifying).
**Relates to:** ADR-000 (adds decision driver 5), Stage 7 (replaces the visual builder).

## Context

Two AI-native capabilities were proposed:

1. **Generate from sample / shadow template** — given an existing document
   (a PDF of the current invoice, a legacy SAP Smart Forms output, a scan),
   produce a working template.
2. **Assist adjustment on screen** — conversational edits against a live
   preview: "move the totals right", "add a GST column", "shrink the header".

The critical observation: **this project already builds the verifier.** The
Stage 2 corpus infrastructure — deterministic render, PDF normalization,
rasterize, structural diff — is exactly the feedback loop that turns LLM
template generation from a demo into an engineered feature:

```
sample.png ─▶ vision model ─▶ draft template ─▶ render ─▶ rasterize
     ▲                                                        │
     └──── iterate on diff report ◀── structural + visual diff┘
              ("totals block 14mm low; GST column missing;
                expected 3 pages, got 4")
```

Generation without this loop is autocomplete. With it, convergence is
measurable and failure is loud. The same loop, run continuously against live
legacy output, is **shadow parity mode** — the migration story: generate the
candidate template from the legacy sample, shadow-diff every real document
pair against the legacy system's output, cut over when parity holds. For
SAPscript/Smart Forms estates this is the adoption funnel.

## Non-negotiable constraints (hold under every option)

- **AI output is a template like any other.** Same corpus gates, same overflow-
  must-fail, same lifecycle. `TemplateMeta.provenance` records
  `ai-generated` / `ai-assisted`.
- **Patches, not free-drawing.** Adjustment assist emits a reviewable diff
  against the template source; the human accepts or rejects. Undo is version
  control, not a canvas feature.
- **AI edits enter the lifecycle as `draft`.** Stage 5 governance was built
  for exactly this; AI never touches `published`.
- **AI never edits data, rules, or delivery config** — template source only.
- **No payload egress by default.** Samples and shadow documents contain real
  PII (payslips). The loop runs on synthetic/redacted inputs, or against a
  model deployment the operator explicitly configures. Redaction is part of
  the Stage 4 task, not an afterthought.

## Options

### 1. Skill-first (recommended sequencing)
Ship generation as a Claude Code skill in this repo, not product surface:
`.claude/skills/template-from-sample/` drives the existing npm scripts
(render → rasterize → diff) in a loop. First proof is the **round-trip test**:
rasterize the corpus PO, hand the skill only the image, regenerate the
template, diff converges — zero real data involved. Dogfood in Stage 4 by
authoring the invoice and payslip templates from redacted real samples.
- Pro: near-zero cost on top of Stage 2; validates the loop before any
  product surface; immediately useful to the maintainer.
- Con: maintainer-only until productized.

### 2. Product-first
Build upload-sample API + adjust-assist UI on the previewer now.
- Rejected as sequencing: it needs Stage 2 (verifier), Stage 5 (draft
  lifecycle), and a previewer that does not exist yet — building product
  surface before the loop is proven inverts the evidence order.

### 3. No AI layer
- Rejected: the marginal cost over Stage 2 infrastructure is small, the
  migration/onboarding value is large, and every competitor will ship a
  worse, verifier-less version of this.

## Interaction with ADR-000 (this is decision driver 5)

Text templates (Path A: JSON schema or Typst markup) are LLM-native: models
read, generate, and *patch* them reliably, and every change is a reviewable
text diff. Office binaries (Path B) are XML inside a zip: generation and
patching are fragile, diffs are unreadable, and the verification loop muddies.
**AI-native strongly favors Path A — and simultaneously weakens Path B's main
selling point, because "Word is the builder" matters less when the AI is the
builder.** Hybrid (Option C) keeps Path B for business-authored documents
while the AI loop serves the schema path.

## Decision

_Pending. Skill-first tasks are on the roadmap (Stages 2 and 4); the
productized layer is Stage 7 with entry criteria._

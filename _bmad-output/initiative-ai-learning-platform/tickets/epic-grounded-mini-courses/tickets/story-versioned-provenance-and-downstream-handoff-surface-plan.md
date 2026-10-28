---
title: 'Versioned provenance and downstream handoff surface'
type: 'feature'
ticket: '2.7'
created: '2026-10-27'
status: 'built'
baseline_revision: '40946fe'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epics 3/5/6 must consume generated courses through an authorized, versioned contract — today every consumer would reach into ad-hoc reads with no pinned-revision guarantee.

**Approach:** Expose the versioned provenance query surface as a typed contract (course version + lineage ids; objectives with versions; source-linked units with extraction ids/filenames/locators; practice items with objective links and source refs but NEVER answers; verified supplements with identity/hash; why explanations with sources; tracker item inventory) backed by owner-scoped, lineage-fenced read functions in course-generation and served at `GET studies/{root}/provenance?course=<id|version>` (protectedResponse). Pinned-revision reads stay stable across superseding revisions while default reads see the change; out-of-scope fields (recall answers/rationales, practice attempt content) are structurally absent from the contract and explicit requests for them are denied; cross-owner/foreign reads use the standard no-leak taxonomy. Synthetic consumer contract tests prove pinning, supersession and scope denial against a fake consumer written only against the contract types.

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; checkpoints proceed under the standing decision delegation (surfaced, logged, renegotiable). Read-only surface over existing tables — no migration, no new processor configuration, no new dispatch path.

## Boundaries & Constraints

**Always:**
- The contract is attempt-independent: no practice_attempt rows, no attempted text, no recall answers/rationales anywhere in the surface; those fields are not merely hidden, they do not exist in the schema (structural scope denial) and a `fields=` request naming them is `INVALID_INPUT`.
- Version pinning: every read resolves an exact course id/version (default = current confirmed revision's ready course, prior versions addressable); a superseding revision changes default reads but never a pinned read; lineage ids (plan revision, selection, extraction ids, lifecycle object ids, admission id) ride along for downstream fencing (epics 3/5/6 re-authorize through their own scopes).
- Authorization: owner-scoped + lineage-fenced (`assertObjects`) exactly like the course reads; cross-owner/foreign/deleted → `FORBIDDEN_OR_NOT_FOUND` no-leak; ungenerated → honest `none`-style state, not an error.
- Contract-first: zod schemas + types in `src/contracts` are the authority; the synthetic consumer test imports ONLY the contract types (never module internals) and asserts the documented behaviors (pin stability, supersession visibility, scope denial, denial taxonomy).
- No UI work beyond none (this is a handoff surface; the player is unchanged); tests unit+integration, zero skips; browser suite untouched (no user-facing change); `docs/project-structure.md` only if files move; Node v24.22.0, loopback-only.

**Never:**
- No write verbs, no new tables, no scoring/attempt semantics (epic 3), no instructor exposure (epic 5), no activity extension (epic 6); no second serving path for the player (it keeps its own views; this surface may share repository reads but not fork truths).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default read | ready course, current revision | full provenance document for the current confirmed course | — |
| Pinned read | `?course=<prior id/version>` after supersession | the pinned version's document, byte-stable vs before the supersession | — |
| New read after supersede | default read post-regeneration | the new version's document (new lineage, new objectives version) | — |
| Scope denial | `fields=answers` (or any non-contract field) | `INVALID_INPUT` — answers are not in the contract | — |
| Cross-owner / deleted | B on A's root; deleted root | `FORBIDDEN_OR_NOT_FOUND` no-leak | — |
| Ungenerated | confirmed plan, no course | honest empty state (no error) | — |
| Legacy content | v1–v3 stored courses | provenance serves their real shape (single lesson/recall view) | — |
| Attempt independence | practice attempts exist | document identical with/without attempts (asserted) | — |

</frozen-after-approval>

## Code Map

- `src/contracts/courses.ts` (or new `src/contracts/provenance.ts` if cleaner) — the provenance document schema: course {id, version, supersededBy, lineage {planRevisionId, selectionId, extractionIds, objectId, admissionId}, model, factsDigest, adaptation, createdAt, settledAt}, objectives[{position, text, version}], units[{lesson, position, text-ref identity, sourceRef}], practiceItems[{id, objectiveIndex, sourceRef}], supplements[{position, url, origin, locator, hash, retrievedAt, outcome}], whyExplanations[{lesson, depth, dimension, sources}], trackerItems[{id, required, title}]. NO answer/rationale/attempt fields.
- `src/modules/course-generation/{service,repository}.ts` — `getProvenance(identity, rootId, selector?)` + repository read assembling from existing tables (course row + content parse + course_objective/course_source/practice content/supplement rows/why rows); reuse `readyCourseById`/`readyCourseByVersion`/`latestReadyCourse`; fence via existing objectIds.
- `src/app/api/v1/[...path]/route.ts` — GET branch, protectedResponse with the document's objectIds.
- Tests: `tests/integration/course-generation.test.ts` (or a focused new `provenance.test.ts`) — the synthetic consumer: pin → supersede → pinned stable + default moved; scope denial; cross-owner; ungenerated; legacy v1–v3; attempt-independence; unit tests for the document schema (answers structurally absent).

## Tasks & Acceptance

**Execution:**
- [x] `src/contracts/provenance.ts` (or courses.ts extension) — the document schema + selector schema; document that answers/attempt content are out of scope by construction.
- [x] `src/modules/course-generation/{service,repository}.ts` — `getProvenance` assembling the document (v1–v4 content shapes), owner-scoped, fenced.
- [x] `src/app/api/v1/[...path]/route.ts` — the GET branch.
- [x] Tests per Code Map (synthetic consumer imports contract types only).
- [x] `docs/project-structure.md` only if a file is added.

**Acceptance Criteria:**
- Given a superseded course, when a consumer reads the pinned id before and after the superseding generation, then the two documents are identical and default reads return the new version.
- Given any consumer request naming a non-contract field (answers, attempts), when submitted, then `INVALID_INPUT` — the surface structurally cannot serve them.
- Given a foreign owner or deleted root, when reading, then the standard no-leak denial.
- Given practice attempts and why usage, when reading provenance, then the document is identical to a no-attempt study's shape (attempt-independent).
- Given stored v1–v3 courses, when read, then provenance serves their real shape without error.

## Implementation Notes

- Implemented 2026-10-27 at the epic-2 story-2.7 slice: `src/contracts/provenance.ts` (document + state + `fields=` scope-declaration schemas), `getProvenance` in `src/modules/course-generation/service.ts` with three read-only lineage queries in `repository.ts` (`courseObjectiveRows`, `courseSourceRows`, `whyRowsForCourse`), the `studies/{root}/provenance` GET branch in the API route (protectedResponse over the course's objectIds), unit tests (`tests/unit/provenance.test.ts`) and the synthetic consumer integration suite (`tests/integration/provenance.test.ts`). No migration, no write verbs, no player/UI change.
- The state union mirrors the course reads (`none`/`pending`/`failed`/`ready`) so mid-generation honesty matches `getCourse` exactly; the default resolution reuses `courseForPlan`/`latestReadyCourse` and the pinned path reuses `readyCourseById`/`readyCourseByVersion` verbatim.
- The document is split into two blocks (review remediation 2026-10-27): the IMMUTABLE-per-version block (`course`+lineage, `objectives`, `units`, `practiceItems`, `trackerItems` — the pin-and-compare target for epics 3/5/6) and the MONOTONIC DERIVATIVES block (`supplements`, `whyExplanations` — they attach to any ready version, a pinned prior one included, and may only gain entries for a version). Pin stability is claimed for the immutable block only, and holds across supersession AND derivative growth.
- `fields=` is validation-only by design: declaring never projects or filters — the response is always the full contract document; the parameter exists so a consumer's intended scope is checked against the contract (and anything outside it — answers, attempts — is `INVALID_INPUT` before a single row is read). The route joins EVERY value of a repeated `?fields=` parameter into the declaration (`getAll`), so a non-contract name cannot hide behind a first valid one.
- The synthetic consumer (`consumerDocumentOf` in the integration suite) is written only against the contract types, per Design Notes; the harness around it uses the same service/worker entry points as the sibling suites.

## Plan Change Log

- 2026-10-27 — `supersededBy` omitted from the provenance document schema. The Code Map sketch listed it in the course block, but any live successor pointer (the mutable `superseded_by` column set by `supersedePrior`, or a computed newer-ready check) would mutate the pinned block across a superseding revision — directly violating the frozen boundary "a superseding revision changes default reads but never a pinned read" and the byte-stability I/O matrix row. The document instead splits into an immutable-per-version block carrying only immutable row data (id, version, full lineage, model, digest, adaptation, timestamps, objectives, units, practice items, tracker inventory) and a documented monotonic derivatives block (supplements, why explanations) that may only gain entries for a version — so pin stability is the qualified, structural invariant: the immutable block is byte-stable across supersession and derivative growth alike. Consumers see movement the honest way: a fresh default read serves the new version's document (different course id/version/lineage) to compare against their pin — which is exactly the "default reads see the change" behavior the plan specifies.

## Review Triage Log

### Quick lens pass (2026-10-27, 2 findings, verified by the orchestrator)

- **medium** — the provenance route reads only the FIRST `fields` query value (`URLSearchParams.get`), so `?fields=course&fields=answers` bypasses the scope denial the acceptance states universally. → patch (read all values — join or reject repeats — so every named field is validated).
- **medium** — the "pinned document is byte-stable by construction" claim is overclaimed: `supplements` and `whyExplanations` attach to ANY ready version (a pinned prior one included) and legitimately grow through their own passes, so a pinned document mutates through derivative growth even though it is stable across supersession (the actual acceptance). → patch (split the contract into an immutable-per-version `content` block — course lineage, objectives, units, practice items, tracker inventory, byte-stable across everything — and a monotonic `derivatives` block for supplements/why; qualify every comment and the change-log rationale; tests assert the immutable block is byte-stable across supersession AND derivative growth while derivatives only grow).

Verdict counts: medium 2, false 0, maybe-false 0. Both route to patch.

## Design Notes

- One serving truth: the document assembles from the SAME rows the player views use; no parallel content copies. Where the player view derives (e.g. wrapped-v1), provenance uses the same helpers.
- The synthetic consumer test is the contract's proof: it compiles against the contract types and asserts documented behaviors — epics 3/5/6 later copy this pattern as real consumers.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — green, zero skips.
- Browser suite unchanged; full `npm run checks` at the wave boundary after 2.8.

**Manual checks (if no CLI):**
- Read provenance for a generated study (curl with synthetic session); pin, regenerate, re-read both.


### Patch round (2026-10-27)

Both findings patched: the route reads ALL `fields` query values (`getAll` joined, so a repeated parameter cannot smuggle an out-of-contract name past validation — unit and integration cases cover both orders); the contract is split into an immutable-per-version block (course lineage, objectives, units, practice items, tracker inventory — byte-stable across supersession AND derivative growth, the pin-and-compare target) and a documented monotonic derivatives block (supplements, why explanations — attach to any ready version and may only gain entries), with comments, the change-log rationale and the synthetic-consumer tests asserting the qualified invariant (pinned immutable block byte-identical across a supplement pass on the pinned version; derivatives monotonic). Post-patch: boundaries, both typechecks, lint, unit 232/232, integration 173/173.

---
title: 'Background and goal adaptation'
type: 'feature'
ticket: '2.4'
created: '2026-10-27'
status: 'built'
baseline_revision: 'cfe0447'
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
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Generation ignores the learner's saved background/goal preferences — the same objective reads identically for a non-CS beginner and a CS graduate, which is exactly what parent R8 forbids.

**Approach:** Consume epic-1 S4's saved background/goal/timezone preferences in generation: a deterministic track classifier (beginner | advanced | neutral over the stated background), per-track treatment in the prompt and the synthetic fixture — plain language, familiar examples and explicit prerequisites for beginners; application scenarios and trade-off depth for advanced — with IDENTICAL factual claims and source links across tracks. The generated content records its adaptation basis; changed preferences flow to the next confirmed revision through the existing preference-revision pin (honest re-save → re-confirm → new course version) without touching earned tracker state; missing/empty background defaults neutrally. The unreviewed label, visible sources and the error-report path (help footer) stay present on adapted lessons.

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; checkpoints proceed under the standing decision delegation (surfaced, logged, renegotiable). The stated background is a new data category sent to the processor path, so migration inserts processor_configuration **v7** (cumulative purpose; categories add "stated background") — existing v6 grants honestly lapse; one owner re-grant gates generation again. No other admission changes; the synthetic fixture remains the only processor.

## Boundaries & Constraints

**Always:**
- Adaptation never weakens content: factual claims, source links, lesson titles/order, required items and recall answers are IDENTICAL across tracks; only the treatment text differs (framing paragraphs, example choice, prerequisite callouts, scenario/trade-off depth). The strict parser enforces this: cross-track facts come from the same plan/sources; a draft whose factual sections differ by track beyond the treatment fields is invalid.
- Deterministic classification: track = classify(background) as pure code (beginner/advanced keyword families documented in tests); empty/missing/unmatched background → `neutral` (no invention — the lesson says nothing about a track it cannot infer). The content stores `adaptation {track, backgroundSummary}`; the served view exposes it and keeps the "AI-generated · Unreviewed" label, per-section sources and the help footer's report path.
- Preference changes regenerate honestly through existing machinery only: the epic-1 preference-revision pin already forces re-save/re-confirm after goal/topic/background changes; the new course version supersedes (2.3 pinning/switch/diff UI applies unchanged); tracker rows of prior versions are never rewritten (per-version state).
- v7 migration additive (`ON CONFLICT DO NOTHING`); no new tables (adaptation lives in content jsonb; preferences storage is epic-1's unchanged); tests unit+integration+browser, zero skips; `docs/project-structure.md` only if paths change; Node v24.22.0, loopback-only, no new dependencies, no live dispatch, no egress.

**Never:**
- No second generation path, no per-track variants stored side by side per course (one course per confirmed revision, generated under the preferences pinned at that confirmation); no requirement weakening or source hiding for any track; no instructor surfaces; no completion/credit semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Beginner track | background "non-CS, new to programming" | plain-language framing, familiar example, explicit prerequisites; facts/sources identical to other tracks | — |
| Advanced track | background "CS graduate, interview prep" | application scenarios + trade-off depth; facts/sources identical | — |
| Neutral default | empty/unmatched background | neutral treatment; no track claims | — |
| Side-by-side (verification) | same objective generated under two tracks | distinct treatment, identical factual claims + source links (asserted on content) | — |
| Preferences changed | background/goal edited after a course exists | existing pin forces re-save → re-confirm; next generation supersedes with new adaptation; prior tracker state untouched | — |
| Consent | v7 not granted | honest blocked state, zero effect (existing machinery) | — |
| Stored v1/v2 courses | pre-2.4 content | serve unchanged (no adaptation field ⇒ neutral presentation) | — |
| Cross-owner / deleted | B; deleted root | standard denial taxonomy | — |

</frozen-after-approval>

## Code Map

- `src/contracts/preferences.ts` — `Preferences.background/goal/timezone` (pinned GET shape); `savePreferencesSchema`; the preference-revision pin machinery in `materials-setup/service.ts` (`savePlan` pins `preference_revision`; `confirmPlan` enforces).
- `src/modules/course-generation/{generation,worker,service}.ts` — prompt gains the stated background + per-track instruction; fixture emits per-track treatment fields; strict parser validates track-bounded differences; content v3 (v2 + `adaptation`); `getCourse` serves v1/v2/v3 (missing adaptation ⇒ neutral); worker reads `preferenceRow` (already does for goal/topic).
- `src/contracts/courses.ts` — content v3 union, treatment fields (per-lesson `framing` text distinct from factual sections), `adaptation {track, backgroundSummary}`.
- `migrations/016` (v6 precedent) — `018` inserts v7 (`52410003-…-000000000007`, cumulative purpose + "stated background" category, honest retention notice).
- `src/app/course-stage.tsx` — adaptation line in the ready view ("Pitched for: …" from the stored track; neutral says nothing false); nothing else changes (2.3 pinning/switch intact).
- `src/app/goal-stage.tsx` — the background field UI exists; no changes expected beyond any honest copy.
- Tests: `tests/unit/course-generation.test.ts` (classifier, per-track fixture, cross-track fact identity, parser rejections), `tests/integration/course-generation.test.ts` (side-by-side two-track generation with identical sources/claims, changed-preferences → re-confirm → superseding version with new adaptation + tracker untouched, neutral default, v1/v2 serving), `tests/browser/course.spec.ts` (adapted lesson shows the pitch line + label + sources; keyboard unchanged).

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/018-adaptation-purpose.sql` — v7 processor_configuration INSERT (cumulative; "stated background" category); idempotent.
- [ ] `src/modules/course-generation/adaptation.ts` (or in generation.ts) — pure `classifyTrack(background)`, per-track prompt instruction builder, treatment-field generators (fixture), and the cross-track fact-identity validator used by tests/parser.
- [ ] `src/contracts/courses.ts` — content v3 (adaptation + per-lesson framing), union serving.
- [ ] `src/modules/course-generation/{generation,worker}.ts` — prompt/fixture/parser/serving changes; facts and source refs provably track-independent.
- [ ] `src/app/course-stage.tsx` — honest pitch line on adapted lessons.
- [ ] Tests (unit/integration/browser per Code Map).
- [ ] `docs/project-structure.md` only if files move.

**Acceptance Criteria:**
- Given the same confirmed plan and sources generated under beginner and advanced backgrounds, when the two courses are compared, then the treatment differs appropriately while every factual section, source ref, lesson title and recall answer is identical.
- Given an empty or unmatched background, when generated, then the course is neutral and claims no track.
- Given changed preferences after a course exists, when the learner re-saves and re-confirms, then the next generation supersedes with the new adaptation and prior-version tracker state is untouched.
- Given stored pre-2.4 courses, when opened, then they serve unchanged.
- Given adapted lessons, when studied, then the unreviewed label, per-section sources and report path are present.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Quick lens pass (2026-10-27, 6 findings, verified by the orchestrator)

- **medium** — the frozen "strict parser enforces cross-track fact identity" sentence over-reached: a single-draft parse cannot compare across tracks, and `factsIdenticalAcrossTracks` is test-surface only. Enforceable half patched (content records a `factsDigest` of the factual core so any consumer can compare courses cheaply — entry 7 consumes it); the mechanism overreach is recorded here and in the Plan Change Log; F-A live admission must re-examine prompt-level track containment. → patch (digest) + record.
- **medium** — the worker reads current preferences at consume time, so a background edited between confirm and worker-run pitches under the newer background; the frozen Never bullet says "generated under the preferences pinned at that confirmation". → patch (the request row pins the pitch-relevant preference fields at request time; the worker uses the pinned values, falling back for legacy rows).
- **low** — the advanced pitch line asserts "a CS-graduate level" for learners the classifier never credentialed (developer/engineer/interview keywords). → patch (credential-free copy: "an experienced-developer level").
- **medium** — framing describes the promised treatment instead of delivering it (no actual example, no spelled-out prerequisite; same shape on the advanced track). → patch (fixture DELIVERS: beginner framing carries a concrete everyday example derived from the lesson's own terms and an explicit prerequisite line; advanced framing carries an application scenario and a trade-off question).
- **low (recorded)** — frozen Intent names timezone among consumed preferences; generation consumes the pitch-relevant fields (background/goal/topic) — timezone serves the epic-1 reminder machinery and has no pitch role. Divergence recorded, no code change (delivery-checks wording, not a failed AC).
- **false** — "out-of-scope edit to tests/unit/source-fetch.test.ts": the change is a type-guard reorder of the orchestrator-authorized 2.3-close flakiness fix (retrievedAt comparison) required for the typecheck gate; functionally equivalent for passing runs, no behavior change.

Verdict counts: medium 3, low 2, false 1, maybe-false 0. Patches: digest, pinned preferences, pitch copy, delivered framing.

## Design Notes

- Keep treatment OUT of the factual sections: framing is a separate per-lesson field (rendered before the sections) so "identical factual claims" is structurally checkable — sections are byte-identical across tracks, only framing/adaptation differ. This is what makes the side-by-side acceptance provable rather than eyeballed.
- Track keywords: beginner family ("non-cs", "beginner", "new to programming", "no programming", "first time", "non-technical"); advanced family ("cs graduate", "computer science degree", "developer", "engineer", "interview", "professional", "experienced"). First match wins, case-insensitive, documented in unit tests; ties/none → neutral.
- The prompt's track instruction mirrors the PRD FR-8 consequence wording; the fixture implements it deterministically.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run migrate` — 018 additive.
- `npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — green, zero skips.
- `npm run build && npm run test:e2e` — adapted-lesson journey green; typegen dance, dev state restored.
- Wave-boundary full `npm run checks` after this entry.

**Manual checks (if no CLI):**
- Generate the same plan under two backgrounds; compare framing vs facts; change background; re-confirm; verify superseding version and untouched tracker.


### Plan Change Log (orchestrator, 2026-10-27)

- The frozen Boundaries sentence "the strict parser enforces cross-track fact identity" over-reached mechanically: a single-draft parse cannot compare across tracks. Enforcement as shipped is structural (factual sections derive from the same plan/sources; the parser derives the track in code and rejects processor-supplied tracks) plus a stored per-course `factsDigest\ over the canonical factual core (added in the patch round) so any consumer can compare courses cheaply; `factsIdenticalAcrossTracks\ proves it in tests. F-A live admission must re-examine prompt-level track containment for a live processor.
- The frozen "preference-revision pin already forces re-save/re-confirm after … background changes" claim was wrong: epic-1 pins only goal/topic/clarification (a standing contract the entry did not alter). The patch round added request-time `preference_pin\ snapshots (goal/topic/background pinned onto the course request row; the worker consumes the pin), so a consume-time background edit can no longer re-pitch a settled course.
- Recorded divergence: frozen Intent names timezone among consumed preferences; generation consumes the pitch-relevant fields (background/goal/topic). Timezone serves the epic-1 reminder machinery and has no pitch role — no failed acceptance, wording only.

### Patch round (2026-10-27)

All four real findings patched (preference pin + fallback-for-legacy test; framing now DELIVERS the treatment — everyday example + explicit prerequisite line / scenario + trade-off question — with content-shape assertions; credential-free advanced pitch copy; stored factsDigest with cross-track equality, drift sensitivity and treatment insensitivity asserted, filename+locator-level source identity so cross-study digests compare honestly). Wave-boundary gate after patches: orchestrated `npm run checks\ green through production build (unit 206, integration 150, extractor, audit, lint, boundaries, both typechecks); the two recurring batches.spec parser-contention flakes failed in the orchestrated e2e context only and the FULL standalone e2e run passed 56/56 plus restart smoke green (course + supplement beats); dev typecheck state restored and green.

import { z } from "zod";
import { uuid } from "./setup";
import {
  courseAdaptationSchema,
  courseItemIdPattern,
  practiceCardIdPattern,
  supplementOutcomes,
  whyDimensions,
  whySourceSchema,
} from "./courses";

// Epic-2 S7 (versioned provenance and downstream handoff surface) contracts.
// This is the authorized, versioned query surface epics 3/5/6 consume instead
// of ad-hoc reads: one document per resolved course version, split into an
// IMMUTABLE-PER-VERSION block (byte-stable across superseding revisions and
// across the version's own derivative growth — the pin-and-compare target)
// and a MONOTONIC DERIVATIVES block (supplements/why may only gain entries
// for a version).
//
// The contract is ATTEMPT-INDEPENDENT by construction: recall answers and
// rationales, practice attempt content (attempted text, outcomes, evidence
// kinds) and tracker done state do not exist as fields anywhere below — not
// merely hidden. Every object schema is strict, so a payload carrying any of
// them fails validation, and the `fields=` scope-declaration set (below) has
// no name for them either: a request naming one is INVALID_INPUT, the surface
// structurally cannot serve it.

// One source-linked location inside a unit/practice item: the same identity
// triple every course view serves (per-upload extraction id, filename,
// locator).
const provenanceSourceRefSchema = z.strictObject({
  extractionId: uuid,
  filename: z.string().trim().min(1).max(184),
  locator: z.string().trim().min(1).max(120),
});
export type ProvenanceSourceRef = z.infer<typeof provenanceSourceRefSchema>;

// One source-linked content unit: a lesson section at its 1-based lesson
// number, the lesson's plan-owned title, its 0-based position inside the
// lesson, the served section text and the source it draws from. The text is
// the learner-served lesson text — never an answer, rationale or attempt.
export const provenanceUnitSchema = z.strictObject({
  lesson: z.number().int().min(1).max(8),
  title: z.string().trim().min(1).max(200),
  position: z.number().int().min(0).max(7),
  text: z.string().trim().min(1).max(2000),
  sourceRef: provenanceSourceRefSchema,
});
export type ProvenanceUnit = z.infer<typeof provenanceUnitSchema>;

// One practice item: the stable card id, the objective it examines and the
// source location its answer draws from. The prompt, the canonical answer and
// the rationale are structurally absent — the answer reveal path is per-card
// submission feedback and nothing else.
export const provenancePracticeItemSchema = z.strictObject({
  id: z.string().regex(practiceCardIdPattern),
  objectiveIndex: z.number().int().min(0).max(7),
  sourceRef: provenanceSourceRefSchema,
});
export type ProvenancePracticeItem = z.infer<typeof provenancePracticeItemSchema>;

// One verified supplement record of the course version's latest settled pass:
// identity (url/origin), location inside the fetched source, content hash,
// retrieval time and the honest checked outcome. The fetched passage and the
// conflict excerpts stay in the supplement views; this surface carries the
// verifiable identity, not the content.
export const provenanceSupplementSchema = z.strictObject({
  position: z.number().int().min(0).max(7),
  outcome: z.enum(supplementOutcomes),
  url: z.string().trim().min(8).max(512),
  origin: z.string().trim().min(1).max(253),
  locator: z.string().trim().min(1).max(200).nullable(),
  hash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  retrievedAt: z.iso.datetime().nullable(),
});
export type ProvenanceSupplement = z.infer<typeof provenanceSupplementSchema>;

// One settled why explanation derivative of the course version (per lesson and
// depth), with its fixed dimension and resolved visible-source citations.
export const provenanceWhySchema = z.strictObject({
  lesson: z.number().int().min(1).max(8),
  depth: z.number().int().min(1).max(2),
  dimension: z.enum(whyDimensions),
  sources: z.array(whySourceSchema).min(1).max(4),
});
export type ProvenanceWhyExplanation = z.infer<typeof provenanceWhySchema>;

// One tracker inventory row: the stable item id, its required flag and title.
// Done state is learner state, not provenance — deliberately absent.
export const provenanceTrackerItemSchema = z.strictObject({
  id: z.string().regex(courseItemIdPattern),
  required: z.boolean(),
  title: z.string().trim().min(1).max(200),
});
export type ProvenanceTrackerItem = z.infer<typeof provenanceTrackerItemSchema>;

// The course block: exact version identity plus the full generation lineage a
// downstream consumer re-authorizes through its own scopes (plan revision,
// selection, extraction ids, the course's lifecycle object, the admission).
// There is deliberately NO supersededBy/superseded pointer here: any live
// successor signal would mutate the immutable block across a superseding
// revision. The immutable block is byte-stable by construction; consumers see
// movement the honest way — a fresh default read serves the new version's
// document (different course id/version/lineage) to compare against their pin.
export const provenanceCourseSchema = z.strictObject({
  id: uuid,
  version: z.number().int().min(1),
  lineage: z.strictObject({
    planRevisionId: uuid,
    selectionId: uuid,
    extractionIds: z.array(uuid).min(1),
    objectId: uuid.nullable(),
    admissionId: uuid,
  }),
  model: z.string(),
  factsDigest: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  adaptation: courseAdaptationSchema.nullable(),
  createdAt: z.iso.datetime(),
  settledAt: z.iso.datetime(),
});
export type ProvenanceCourse = z.infer<typeof provenanceCourseSchema>;

// The objectives with their versions: the versioned course_objective lineage
// rows (015) of this course version — each objective carries the course
// version it belongs to, so a pinned-vs-default comparison shows the version
// movement without any mutable state.
export const provenanceObjectiveSchema = z.strictObject({
  position: z.number().int().min(0).max(7),
  text: z.string().trim().min(1).max(300),
  version: z.number().int().min(1),
});
export type ProvenanceObjective = z.infer<typeof provenanceObjectiveSchema>;

// The IMMUTABLE-PER-VERSION block: course identity + lineage, objectives,
// units, practice items and the tracker inventory. Every field is immutable
// row data of the resolved version, so this block is byte-stable across a
// superseding revision AND across the version's own derivative growth — the
// pin-and-compare target for epics 3/5/6.
export const provenanceImmutableBlockSchema = z.strictObject({
  course: provenanceCourseSchema,
  objectives: z.array(provenanceObjectiveSchema).min(1).max(8),
  units: z.array(provenanceUnitSchema).min(1),
  practiceItems: z.array(provenancePracticeItemSchema).min(1).max(8),
  trackerItems: z.array(provenanceTrackerItemSchema).min(1),
});
export type ProvenanceImmutableBlock = z.infer<typeof provenanceImmutableBlockSchema>;

// The MONOTONIC DERIVATIVES block: the version's verified supplements and why
// explanations. These attach to any ready version — a pinned prior one
// included — and legitimately GROW through their own passes, so they are
// deliberately outside the immutable block: a version's derivatives may only
// gain entries, never rewrite or drop one.
export const provenanceDerivativesBlockSchema = z.strictObject({
  supplements: z.array(provenanceSupplementSchema).max(8),
  whyExplanations: z.array(provenanceWhySchema).max(16),
});
export type ProvenanceDerivativesBlock = z.infer<typeof provenanceDerivativesBlockSchema>;

// The full provenance document of ONE resolved course version: the immutable
// block plus the monotonic derivatives block. One serving truth: every array
// assembles from the SAME rows the player views use (stored content + its
// lineage tables), never a parallel copy.
export const provenanceDocumentSchema = z.strictObject({
  immutable: provenanceImmutableBlockSchema,
  derivatives: provenanceDerivativesBlockSchema,
});
export type ProvenanceDocument = z.infer<typeof provenanceDocumentSchema>;

// Owner-scoped provenance state, mirroring the course states: `none` is the
// honest empty state of a confirmed plan whose course has not been generated;
// `pending`/`failed` are the honest mid-generation states of the current
// confirmed revision's row. Only `ready` carries the document.
export type ProvenanceState =
  | { state: "none"; rootId: string; revision: number }
  | { state: "pending"; rootId: string; revision: number; requestId: string }
  | { state: "failed"; rootId: string; revision: number; requestId: string; failureCode: string | null }
  | { state: "ready"; rootId: string; revision: number; provenance: ProvenanceDocument };

// The `fields=` scope declaration: the names a consumer may ask for. Anything
// else — answers, rationales, attempts, invented names — is invalid input:
// the field does not exist in the contract, so the surface cannot serve it.
// Declaring fields never projects or filters: the response is always the full
// contract document; the parameter exists so a consumer's intended scope is
// checked against the contract before anything is served.
export const provenanceFieldNames = [
  "course",
  "lineage",
  "objectives",
  "units",
  "practiceItems",
  "supplements",
  "whyExplanations",
  "trackerItems",
] as const;
export type ProvenanceFieldName = (typeof provenanceFieldNames)[number];
const provenanceFieldNameSet: ReadonlySet<string> = new Set(provenanceFieldNames);

// Pure parser (contracts import no platform): the caller turns `{ ok: false }`
// into INVALID_INPUT. An empty declaration names no contract field and is
// likewise invalid.
export function parseProvenanceFields(raw: string): { ok: true; fields: ProvenanceFieldName[] } | { ok: false } {
  const names = raw.split(",").map(name => name.trim());
  if (names.length === 0 || names.some(name => !provenanceFieldNameSet.has(name))) return { ok: false };
  // Sound narrowing: every remaining name is a member of the field-name set.
  return { ok: true, fields: names.map(name => name as ProvenanceFieldName) };
}

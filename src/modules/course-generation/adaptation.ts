import { createHash } from "node:crypto";
import {
  courseTracks,
  type CourseContentServing,
  type CourseTrack,
} from "../../contracts/courses";

// Epic-2 S4 background/goal adaptation — the PURE halves. Deterministic track
// classification over the stated background, the per-track prompt instruction
// (mirroring the PRD FR-8 consequence wording), the deterministic per-track
// treatment framing the local synthetic fixture emits, and the cross-track
// fact-identity validator that makes "identical factual claims and source
// links across tracks" structurally checkable rather than eyeballed. No I/O
// anywhere. The track is ALWAYS derived here by code, never taken from
// processor output: an empty, missing or unmatched background classifies
// neutral and the lesson claims no track it cannot infer (no invention).

// Keyword families (frozen plan Design Notes; documented in the unit tests).
// Matching is case-insensitive substring over the trimmed background; the
// LEFTMOST keyword occurrence in the text wins, and an exact same-position tie
// between the families classifies neutral.
const BEGINNER_KEYWORDS: readonly string[] = [
  "non-cs", "beginner", "new to programming", "no programming", "first time", "non-technical",
];
const ADVANCED_KEYWORDS: readonly string[] = [
  "cs graduate", "computer science degree", "developer", "engineer", "interview", "professional", "experienced",
];

function earliestKeyword(value: string, keywords: readonly string[]): number {
  let best = -1;
  for (const keyword of keywords) {
    const found = value.indexOf(keyword);
    if (found >= 0 && (best < 0 || found < best)) best = found;
  }
  return best;
}

// track = classify(background) as pure code. First match (leftmost occurrence)
// wins; none/empty ⇒ neutral. The equal-index tie is unreachable with the
// shipped families (no keyword is a prefix of one from the other family) but
// keeps a future keyword edit from silently flipping tracks.
export function classifyTrack(background: string): CourseTrack {
  const value = background.trim().toLowerCase();
  if (!value) return "neutral";
  const beginner = earliestKeyword(value, BEGINNER_KEYWORDS);
  const advanced = earliestKeyword(value, ADVANCED_KEYWORDS);
  if (beginner < 0 && advanced < 0) return "neutral";
  if (advanced < 0) return "beginner";
  if (beginner < 0) return "advanced";
  if (beginner === advanced) return "neutral";
  return beginner < advanced ? "beginner" : "advanced";
}

export function isCourseTrack(value: string): value is CourseTrack {
  return (courseTracks as readonly string[]).includes(value);
}

// Bounded summary of what was actually stated — stored verbatim (whitespace
// collapsed, at most the preferences field's 400 characters), never invented.
export function backgroundSummaryOf(background: string): string {
  return background.trim().replace(/\s+/gu, " ").slice(0, 400);
}

// The per-track prompt instruction (PRD FR-8 consequence wording). The
// treatment NEVER weakens content: factual claims, source locations, lesson
// titles and recall answers stay exactly as the sources state them.
export function trackInstruction(track: CourseTrack): string {
  switch (track) {
    case "beginner":
      return "Track instruction: BEGINNER (non-CS, new to programming). Pitch each lesson in plain language, use familiar everyday examples, and spell out explicit prerequisites before the teaching sections. Framing is additive treatment only — it must not weaken, hide or add factual claims.";
    case "advanced":
      return "Track instruction: ADVANCED (CS graduate or working developer). Pitch each lesson toward application scenarios and trade-off depth: where the material holds in practice, where it breaks, and what each choice costs. Framing is additive treatment only — it must not weaken, hide or add factual claims.";
    default:
      return "Track instruction: NEUTRAL (no background could be inferred). Pitch nothing track-specific: teach exactly what the sources state and claim no track.";
  }
}

// The deterministic treatment framing the local synthetic fixture emits for
// one lesson. The framing DELIVERS the promised treatment, not a description
// of it: the beginner track gets a concrete everyday example anchored on the
// lesson's own outcome text plus an explicit prerequisite line; the advanced
// track gets an actual application-scenario sentence and a concrete
// trade-off question. Prose only — it references the plan's own outcome and
// never states a fact the sources do not.
export function framingFor(input: { track: CourseTrack; lessonNumber: number; title: string; outcome: string }): string {
  const title = input.title.trim();
  // A bounded keyphrase of the lesson's own outcome text: the longest prefix
  // that fits 80 characters without splitting a word.
  const raw = input.outcome.trim();
  const cut = raw.slice(0, 80);
  const key = (cut.length < raw.length ? cut.replace(/\s+\S*$/u, "") || cut : cut).replace(/[.!?]$/u, "");
  switch (input.track) {
    case "beginner":
      return `Plain-language walkthrough of “${title}”. Everyday example: working toward “${key}” is like following a recipe — you lay the ingredients out first, follow the steps in order, and only then taste the result. Before this lesson you need: plain reading only — no prior programming assumed.`.slice(0, 600);
    case "advanced":
      return `Application focus on “${title}”. Scenario: it is release week, “${key}” is on your critical path, and you must decide where this earns its keep in a real codebase. Trade-off to weigh: when is this the wrong tool here, and what does reaching for it anyway cost you?`.slice(0, 600);
    default:
      return `“${title}” is presented directly as your sources state it; no track-specific framing was added.`.slice(0, 600);
  }
}

// ---------------------------------------------------------------------------
// The cross-track fact-identity validator. The factual core of a course is
// everything EXCEPT the treatment fields (per-lesson framing + the adaptation
// record): lesson titles in order, every section's text and source ref, the
// objectives, the recall item (including its canonical answer) and the
// optional enrichment. Two courses generated from the same plan and sources
// under different tracks must have identical cores — this is the strict check
// behind the side-by-side acceptance. `ignoreSourceIds` compares source refs
// at filename+locator level for cross-study comparisons, where each study owns
// its own extraction ids.
// ---------------------------------------------------------------------------

export type FactIdentity = { identical: boolean; differences: string[] };

const sameSourceRef = (
  a: { extractionId: string; filename: string; locator: string } | undefined,
  b: { extractionId: string; filename: string; locator: string } | undefined,
  ignoreSourceIds: boolean,
): boolean => {
  if (!a || !b) return a === b;
  if (a.filename !== b.filename || a.locator !== b.locator) return false;
  return ignoreSourceIds || a.extractionId === b.extractionId;
};

export function factsIdenticalAcrossTracks(
  a: CourseContentServing,
  b: CourseContentServing,
  options: { ignoreSourceIds?: boolean } = {},
): FactIdentity {
  const ignoreSourceIds = options.ignoreSourceIds ?? false;
  const differences: string[] = [];
  if (a.lessons.length !== b.lessons.length) differences.push("lessons.length");
  a.lessons.forEach((lesson, index) => {
    const other = b.lessons[index];
    if (lesson.title !== other?.title) differences.push(`lessons[${index}].title`);
    if ((lesson.sections?.length ?? 0) !== (other?.sections?.length ?? 0)) differences.push(`lessons[${index}].sections.length`);
    lesson.sections.forEach((section, sectionIndex) => {
      const otherSection = other?.sections[sectionIndex];
      if (section.text !== otherSection?.text) differences.push(`lessons[${index}].sections[${sectionIndex}].text`);
      if (!sameSourceRef(section.sourceRef, otherSection?.sourceRef, ignoreSourceIds)) differences.push(`lessons[${index}].sections[${sectionIndex}].sourceRef`);
    });
  });
  if (JSON.stringify(a.objectives) !== JSON.stringify(b.objectives)) differences.push("objectives");
  // Epic-2 S5: the practice set is factual core. A v4 row compares its full
  // card set (prompt, canonical answer, rationale, objective index, source
  // ref); a pre-2.5 row's single recall keeps its own comparison. Mixing a
  // practice-set row with a single-recall row is honest drift, not identity.
  if ("practice" in a || "practice" in b) {
    if (!("practice" in a) || !("practice" in b)) differences.push("practice");
    else if (a.practice.cards.length !== b.practice.cards.length) differences.push("practice.cards.length");
    else a.practice.cards.forEach((card, index) => {
      const other = b.practice.cards[index];
      if (
        card.id !== other?.id
        || card.objectiveIndex !== other?.objectiveIndex
        || card.prompt !== other?.prompt
        || card.answer !== other?.answer
        || card.rationale !== other?.rationale
        || !sameSourceRef(card.sourceRef, other?.sourceRef, ignoreSourceIds)
      ) differences.push(`practice.cards[${index}]`);
    });
  } else if (
    a.recall.prompt !== b.recall.prompt
    || a.recall.answer !== b.recall.answer
    || a.recall.rationale !== b.recall.rationale
    || a.recall.objectiveIndex !== b.recall.objectiveIndex
    || !sameSourceRef(a.recall.sourceRef, b.recall.sourceRef, ignoreSourceIds)
  ) differences.push("recall");
  if (
    (a.enrichment?.text ?? null) !== (b.enrichment?.text ?? null)
    || !sameSourceRef(a.enrichment?.sourceRef, b.enrichment?.sourceRef, ignoreSourceIds)
  ) differences.push("enrichment");
  return { identical: differences.length === 0, differences };
}

// ---------------------------------------------------------------------------
// The content-level FACTS DIGEST. SHA-256 over a canonical serialization of
// the factual core — lesson titles in order, every section's text, its
// source's FILENAME + locator, the objectives, the full recall item
// (including its canonical answer) and the optional enrichment. This covers
// the review's named minimum (lesson titles, section texts + source refs,
// recall answer) PLUS the remaining factual fields the cross-track validator
// compares, because a narrower digest could report false identity for courses
// that differ in those fields. Source refs enter at filename+locator level —
// the study-INDEPENDENT factual identity — so the digest is shared by two
// courses generated from the same plan and source files under different
// tracks (or in different studies); the per-upload extractionId is identity,
// not fact, and would break every cross-course comparison. Treatment
// (framing, adaptation) never enters the digest either. Computed by the
// strict parser at settle time and stored in the content so any consumer
// (entry 7's provenance surface included) checks cross-course fact identity
// cheaply.
// ---------------------------------------------------------------------------

const sourceRefTuple = (ref: { filename: string; locator: string }) =>
  [ref.filename, ref.locator] as const;

export function computeFactsDigest(core: {
  lessons: Array<{ title: string; sections: Array<{ text: string; sourceRef: { filename: string; locator: string } }> }>;
  objectives: Array<{ index: number; text: string }>;
  recall?: { objectiveIndex: number; prompt: string; answer: string; rationale: string; sourceRef: { filename: string; locator: string } };
  cards?: Array<{ id: string; objectiveIndex: number; prompt: string; answer: string; rationale: string; sourceRef: { filename: string; locator: string } }>;
  enrichment?: { text: string; sourceRef: { filename: string; locator: string } } | undefined;
}): string {
  const canonical = [
    core.lessons.map(lesson => [
      lesson.title,
      lesson.sections.map(section => [section.text, ...sourceRefTuple(section.sourceRef)]),
    ]),
    core.objectives.map(objective => [objective.index, objective.text]),
    // Epic-2 S5: content v4 digests the FULL practice set (every withheld
    // canonical answer included); a pre-2.5 core digests its single recall.
    // The two forms differ by construction, so a v3 row never reports false
    // identity with a v4 row.
    core.cards
      ? core.cards.map(card => [card.id, card.objectiveIndex, card.prompt, card.answer, card.rationale, ...sourceRefTuple(card.sourceRef)])
      : [
          core.recall!.objectiveIndex,
          core.recall!.prompt,
          core.recall!.answer,
          core.recall!.rationale,
          ...sourceRefTuple(core.recall!.sourceRef),
        ],
    ...(core.enrichment ? [[core.enrichment.text, ...sourceRefTuple(core.enrichment.sourceRef)]] : []),
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

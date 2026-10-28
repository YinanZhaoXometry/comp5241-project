import {
  SYNTHETIC_COURSE_MODEL,
  courseContentV4Schema,
  courseDraftV4Schema,
  readingItemFor,
  type CourseContentV4,
  type EvidenceKind,
  type PracticeCard,
  type PracticeFeedback,
} from "../../contracts/courses";
import type { Plan } from "../../contracts/setup";
import type { TextCompletionPort, TextCompletionRequest, TextCompletionResult } from "../../contracts/ai-provider";
import { backgroundSummaryOf, classifyTrack, computeFactsDigest, framingFor, isCourseTrack, trackInstruction } from "./adaptation";

// Pure prompt building, strict output validation and the deterministic local
// synthetic processor for the epic-2 course tracer. Epic-2 S3 (2.3) widened the
// reply from one lesson to the confirmed plan's FULL lesson set: the fixture
// distributes the acknowledged sources fairly across the plan's lessons and
// adds one labeled optional enrichment passage. Epic-2 S4 (2.4) adds background
// adaptation: the stated background rides the prompt with a deterministic
// per-track instruction, every lesson gains ONE TREATMENT framing paragraph
// (kept OUT of the factual sections so cross-track fact identity is
// structurally checkable), and the settled content records its adaptation
// basis {track, backgroundSummary} — the track is derived by code, never taken
// from the reply. Epic-2 S5 replaces the single recall item with the PRACTICE
// SET: one recall card per confirmed-plan objective, each card's canonical
// answer derived from its own source and withheld from every served text. No
// I/O anywhere: the caller supplies the confirmed plan, the stated
// goal/topic/background and the excerpt store's texts; everything here is
// deterministic and bounded. The synthetic completion implements
// TextCompletionPort over its own input messages so the worker stays identical
// in shape to runAiDraft — F-A can later swap the port for
// createLiveCompletion() without pipeline changes.

const TOTAL_CONTENT_BYTES = 30 * 1024;
const MIN_EXCERPT_BYTES = 256;
const SECTION_MAX_CHARS = 480;
const ANSWER_MAX_CHARS = 300;

const encoder = new TextEncoder();
function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

// Longest prefix (at a character boundary) whose UTF-8 size fits the budget.
function truncateToBytes(text: string, limit: number): { text: string; truncated: boolean } {
  if (byteLength(text) <= limit) return { text, truncated: false };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(text.slice(0, middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return { text: text.slice(0, low), truncated: true };
}

export type CourseSource = { name: string; text: string };
export type CourseInput = { goal: string; topic: string; background: string; plan: Plan; excerpts: CourseSource[] };

const SYSTEM_PROMPT = [
  "You draft a source-linked mini-course inside a local learning prototype.",
  "Answer with STRICT JSON only: no prose, no markdown fences, no comments, no extra keys.",
  'The JSON object has exactly four keys: "lessons" (one object per listed plan lesson, IN LISTED ORDER — never fewer, never more, each with exactly "framing" (1-600 characters of TREATMENT prose pitching this lesson to the stated track per the track instruction: plain language, familiar examples and explicit prerequisites for a beginner track; application scenarios and trade-off depth for an advanced track; no track claims when neutral — framing never states, weakens or hides a factual claim the sources do not)',
  'and "sections" (1 to 8 objects with exactly text (1-2000 characters, teaching prose grounded in the named source),',
  "sourcePosition (integer, the 0-based index into the listed sources the section teaches from) and locator (1-120 characters naming where in that source the text comes from, e.g. 'opening lines'))),",
  '"objectiveIndexes" (ALL of the listed plan outcomes, as distinct 0-based indexes — the course and its practice set cover every outcome),',
  'and "cards" (the active recall PRACTICE SET: exactly one object per listed plan outcome, each with exactly objectiveIndex (integer index into the listed plan outcomes), sourcePosition (integer index into the listed sources),',
  "locator (1-120 characters naming where in that source the card's canonical answer is stated),",
  "prompt (1-1200 characters, one free-recall question whose canonical short answer is stated verbatim in that source),",
  "answer (1-800 characters, the canonical short answer as stated in the source), rationale (1-800 characters explaining the answer per the source)),",
  'and "enrichment" (OPTIONAL; include it only when the sources support one extra optional reading — an object with exactly sourcePosition (integer index into the listed sources),',
  "locator (1-120 characters naming where in that source the passage comes from) and text (1-2000 characters grounded in that source)).",
  "Framing is the ONLY track-dependent part of your reply: sections, objectiveIndexes, cards and enrichment must not depend on the stated track in any way — every factual claim and source link stays exactly as the sources state them.",
  "Lesson titles are taken from the plan itself and are NOT part of your reply. Base every section, every practice card and any enrichment on the provided sources; when the sources do not cover something, do not invent it — teach only what they state.",
].join(" ");

// Bounded system+user message pair over the confirmed plan's exact FULL lesson
// list, outcomes and the acknowledged excerpts (fair byte shares as in the
// ai-setup builder, with the truncation stated plainly in the prompt). The
// stated background rides with its DERIVED track and the per-track instruction
// (epic-2 S4): a new data category the v7 disclosure names.
export function buildCourseMessages(input: CourseInput) {
  const lessons = input.plan.miniCourse.lessons;
  const track = classifyTrack(input.background);
  const summary = backgroundSummaryOf(input.background);
  const header = [
    `Stated learning goal: ${input.goal || "(none stated)"}`,
    `Stated topic: ${input.topic || "(none stated)"}`,
    `Stated background: ${summary || "(none stated)"}`,
    `Derived learning track: ${track}`,
    trackInstruction(track),
    `Mini-course title (context only): ${input.plan.miniCourse.title}`,
    "Plan lessons (index: title — taken from the plan, never returned):",
    ...lessons.map((title, index) => `lesson ${index}: ${title}`),
    "Plan outcomes (index: text):",
    ...input.plan.outcomes.map((outcome, index) => `outcome ${index}: ${outcome}`),
    "Acknowledged source excerpts follow (position: name).",
  ].join("\n");
  const reserved = byteLength(SYSTEM_PROMPT) + byteLength(header) + 512;
  const budget = Math.max(MIN_EXCERPT_BYTES, TOTAL_CONTENT_BYTES - reserved);
  const share = Math.max(MIN_EXCERPT_BYTES, Math.floor(budget / Math.max(1, input.excerpts.length)));
  let truncated = false;
  const sources: string[] = [];
  for (const [index, excerpt] of input.excerpts.entries()) {
    const bounded = truncateToBytes(excerpt.text, share);
    truncated ||= bounded.truncated;
    sources.push(`--- source ${index}: ${excerpt.name} ---\n${bounded.text}`);
  }
  const user = [
    header,
    ...sources,
    truncated ? "Note: one or more sources were longer than the bounded prompt and were truncated to fair prefixes; the omitted text was NOT sent." : null,
    'Return ONLY the JSON object with "lessons", "objectiveIndexes", "cards" and (when supported) "enrichment".',
  ].filter((part): part is string => part !== null).join("\n\n");
  return [{ role: "system" as const, content: SYSTEM_PROMPT }, { role: "user" as const, content: user }];
}

// First balanced top-level JSON object in the text (string/escape aware);
// recovers deterministic complete objects from trailing noise without
// inventing content — the schema below still rejects anything malformed.
// (Exported for the S2 supplement proposal parser, which reuses the exact
// recovery semantics.)
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export type CourseParse = { ok: true; content: CourseContentV4 } | { ok: false };
export type CourseParseSource = { extractionId: string; filename: string };

// Strict validation of the processor reply against the CONFIRMED PLAN's own
// bounds: the draft must carry EXACTLY one lessons entry per plan lesson, in
// listed order — every lesson title is substituted from the plan itself, never
// taken from the reply — with the epic-2 S4 treatment framing per lesson kept
// OUT of the factual sections; the epic-2 S5 practice set must cover EVERY
// plan outcome with EXACTLY one card each (duplicate cards, uncovered
// outcomes, subset coverage and unresolved links are all invalid), and every
// card id is derived here from its objective index. The adaptation record is
// DERIVED HERE from the stated background (pure classifyTrack code, never
// trusted from the reply). Anything else — prose, wrong shapes, a pre-2.5
// single-recall draft, unresolved links — is an INVALID draft that fails
// honestly, never repaired into a course.
export function parseCourseOutput(
  text: string,
  bounds: { plan: Plan; sources: CourseParseSource[]; background: string },
): CourseParse {
  let candidate = text.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  if (fenced) candidate = fenced[1].trim();
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); }
  catch {
    const balanced = firstJsonObject(candidate);
    if (balanced === null) return { ok: false };
    try { parsed = JSON.parse(balanced); } catch { return { ok: false }; }
  }
  const shape = courseDraftV4Schema.safeParse(parsed);
  if (!shape.success) return { ok: false };
  const draft = shape.data;
  const planLessons = bounds.plan.miniCourse.lessons;
  if (draft.lessons.length !== planLessons.length) return { ok: false };
  if (new Set(draft.objectiveIndexes).size !== draft.objectiveIndexes.length) return { ok: false };
  for (const index of draft.objectiveIndexes) if (index >= bounds.plan.outcomes.length) return { ok: false };
  // Practice-set integrity: one card per confirmed-plan objective — the draft
  // must cover ALL plan outcomes (subset coverage is invalid) and the cards
  // must match that coverage exactly, distinctly.
  if (draft.objectiveIndexes.length !== bounds.plan.outcomes.length) return { ok: false };
  if (draft.cards.length !== draft.objectiveIndexes.length) return { ok: false };
  const cardIndexes = draft.cards.map(card => card.objectiveIndex);
  if (new Set(cardIndexes).size !== cardIndexes.length) return { ok: false };
  for (const index of cardIndexes) if (!draft.objectiveIndexes.includes(index)) return { ok: false };
  const resolve = (position: number) => bounds.sources[position] ?? null;
  const lessons: CourseContentV4["lessons"] = [];
  for (const [index, lesson] of draft.lessons.entries()) {
    const sections: CourseContentV4["lessons"][number]["sections"] = [];
    for (const section of lesson.sections) {
      const source = resolve(section.sourcePosition);
      if (!source) return { ok: false };
      sections.push({ text: section.text, sourceRef: { extractionId: source.extractionId, filename: source.filename, locator: section.locator } });
    }
    lessons.push({
      title: planLessons[index],
      framing: lesson.framing,
      sections,
      items: [readingItemFor(index, planLessons[index])],
    });
  }
  const cards: CourseContentV4["practice"]["cards"] = [];
  for (const card of draft.cards) {
    const source = resolve(card.sourcePosition);
    if (!source) return { ok: false };
    cards.push({
      id: `practice:${card.objectiveIndex}`,
      objectiveIndex: card.objectiveIndex,
      sourceRef: { extractionId: source.extractionId, filename: source.filename, locator: card.locator },
      prompt: card.prompt,
      answer: card.answer,
      rationale: card.rationale,
    });
  }
  let enrichment: CourseContentV4["enrichment"];
  if (draft.enrichment) {
    const source = resolve(draft.enrichment.sourcePosition);
    if (!source) return { ok: false };
    enrichment = {
      id: "enrichment:1",
      kind: "enrichment",
      required: false,
      title: "Optional enrichment reading",
      text: draft.enrichment.text,
      sourceRef: { extractionId: source.extractionId, filename: source.filename, locator: draft.enrichment.locator },
    };
  }
  const objectives = draft.objectiveIndexes.map(index => ({ index, text: bounds.plan.outcomes[index] }));
  const content = {
    contentVersion: 4 as const,
    lessons,
    objectives,
    practice: { cards },
    adaptation: {
      track: classifyTrack(bounds.background),
      backgroundSummary: backgroundSummaryOf(bounds.background),
    },
    // Factual-core digest at settle time (treatment excluded) so consumers can
    // check cross-course fact identity cheaply.
    factsDigest: computeFactsDigest({ lessons, objectives, cards, ...(enrichment ? { enrichment } : {}) }),
    ...(enrichment ? { enrichment } : {}),
  };
  const settled = courseContentV4Schema.safeParse(content);
  return settled.success ? { ok: true, content: settled.data } : { ok: false };
}

// Honest free-text judgement for every recall card: a normalized exact match,
// or the canonical answer appearing inside the attempt when the answer is a
// substantial phrase. Uncertain matches are recorded as incorrect — the
// canonical answer is always shown either way, so nothing is guessed.
export function judgeRecall(attempted: string, answer: string): "correct" | "incorrect" {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/gu, " ");
  const a = normalize(attempted);
  const b = normalize(answer);
  if (!a || !b) return "incorrect";
  return a === b || (b.length >= 8 && a.includes(b)) ? "correct" : "incorrect";
}

export function buildPracticeFeedback(input: {
  rootId: string;
  revision: number;
  courseId: string;
  card: PracticeCard;
  attempted: string;
  // The learner's declaration on the practice verb; absent on the evidence-free
  // legacy recall verb — never defaulted, never inferred.
  evidenceKind?: EvidenceKind;
}): PracticeFeedback {
  return {
    rootId: input.rootId,
    revision: input.revision,
    courseId: input.courseId,
    cardId: input.card.id,
    outcome: judgeRecall(input.attempted, input.card.answer),
    attempted: input.attempted,
    answer: input.card.answer,
    rationale: input.card.rationale,
    source: { filename: input.card.sourceRef.filename, locator: input.card.sourceRef.locator },
    ...(input.evidenceKind !== undefined ? { evidenceKind: input.evidenceKind } : {}),
  };
}

// ---------------------------------------------------------------------------
// The local synthetic generation fixture. A PURE function of its own input
// messages: deterministic, no I/O, no config reads, zero-token usage (honest
// accounting — never fabricated counts). It reads the same bounded prompt the
// builder produced (indexed lessons, indexed outcomes, positioned sources) and
// emits a v4 draft the strict parser above accepts for those bounds: every
// plan lesson present in order, sources distributed fairly across the lessons
// (round-robin by source position; each lesson capped at 8 sections), one
// labeled optional enrichment passage when a source supports it, and the
// epic-2 S5 PRACTICE SET — one recall card per plan outcome, each card's
// canonical answer being its own source's opening sentence. WITHHOLDING: every
// source a card draws from has that opening sentence held back — its lesson
// sections and any enrichment teach from the REMAINDER after it — so no served
// course text ever quotes any card's canonical answer.
// ---------------------------------------------------------------------------

function firstSentence(text: string): string {
  const match = text.match(/[^.!?\n]+[.!?]?/u);
  const sentence = (match?.[0] ?? text).trim();
  return sentence.slice(0, ANSWER_MAX_CHARS);
}

function clampText(text: string): string {
  // One tidy paragraph per section: newlines from the source collapse to
  // spaces, then the bounded prefix is taken.
  return text.trim().replace(/\s*\n+\s*/gu, " ").slice(0, SECTION_MAX_CHARS);
}

export function syntheticCourseDraft(messages: TextCompletionRequest["messages"]): string {
  const user = [...messages].reverse().find(message => message.role === "user");
  const content = user?.content ?? "";
  // Structured header only (everything the builder wrote before the excerpt
  // bodies): lesson/outcome counting must never scan source text, where a
  // note line like "lesson 1: intro" would otherwise inflate the counts and
  // fail generation with a false invalid-output.
  const headerEnd = content.indexOf("Acknowledged source excerpts follow");
  const header = headerEnd >= 0 ? content.slice(0, headerEnd) : content;
  const lessonTitles = [...header.matchAll(/^lesson (\d+): (.+)$/gmu)].map(match => match[2].trim());
  const lessonCount = Math.max(1, Math.min(8, lessonTitles.length || [...header.matchAll(/^lesson (\d+): /gmu)].length));
  // The track is the builder's own DERIVED line (deterministic code upstream);
  // anything missing or unrecognized stays honestly neutral.
  const trackLine = header.match(/^Derived learning track: (\S+)$/mu)?.[1] ?? "neutral";
  const track = isCourseTrack(trackLine) ? trackLine : "neutral";
  const outcomes = [...header.matchAll(/^outcome (\d+): (.+)$/gmu)].map(match => ({ index: Number(match[1]), text: match[2].trim() }));
  const sources = [...content.matchAll(/--- source (\d+): (.+?) ---\n([\s\S]*?)(?=\n\n(?:--- source \d+: |Note: |Return ONLY)|$)/gu)].map(match => ({
    position: Number(match[1]),
    name: match[2].trim(),
    text: match[3],
  }));
  const usableOutcomes = outcomes.filter(outcome => outcome.text.length > 0 && outcome.index < 8);
  const usableSources = sources.filter(source => source.text.trim().length > 0);
  const primaryOutcome = usableOutcomes[0] ?? { index: 0, text: "the confirmed plan's first outcome" };
  const outcomeText = (lessonIndex: number) =>
    (usableOutcomes.length ? usableOutcomes[lessonIndex % usableOutcomes.length]?.text : undefined) ?? primaryOutcome.text;
  // The epic-2 S5 practice set: one card per plan outcome, round-robin over
  // the usable sources. Each card's canonical answer is ITS OWN source's
  // opening sentence, and that sentence is held back from every served text
  // (sections and enrichment) of that source — the frozen boundary says no
  // card answer appears in any GET payload.
  const cardsDraft = (usableOutcomes.length >= 1 ? usableOutcomes : [{ index: primaryOutcome.index, text: primaryOutcome.text }]).map((outcome, ordinal) => {
    const source = usableSources[ordinal % Math.max(1, usableSources.length)];
    return source
      ? {
          objectiveIndex: outcome.index,
          sourcePosition: source.position,
          locator: `opening excerpt (first ${firstSentence(source.text).length} characters)`,
          prompt: `From memory, state the key point your source gives for: ${outcome.text}`,
          answer: firstSentence(source.text),
          rationale: `The opening of ${source.name} states this directly.`,
        }
      : {
          objectiveIndex: outcome.index,
          sourcePosition: 0,
          locator: "plan outcome (no excerpt text reached the prompt)",
          prompt: `From memory, state the key point your source gives for: ${outcome.text}`,
          answer: outcome.text,
          rationale: "No source excerpt reached the bounded prompt; the confirmed plan's outcome is the reference.",
        };
  });
  const cardSourcePositions = new Set(cardsDraft.map(card => card.sourcePosition));
  // Withholding-aware section derivation: a source whose opening sentence is
  // some card's withheld answer teaches from the REMAINDER after it; a source
  // no card draws from teaches from its opening. When the remainder is empty
  // the text falls back to a non-quoting summary sentence.
  const heads = new Map(usableSources
    .filter(source => cardSourcePositions.has(source.position))
    .map(source => [source.position, firstSentence(source.text)] as const));
  const sectionFor = (source: { position: number; text: string }): { text: string; locator: string } => {
    const opening = clampText(source.text);
    const head = heads.get(source.position);
    if (!head) return { text: opening, locator: `opening excerpt (first ${opening.length} characters)` };
    const index = source.text.indexOf(head);
    const remainder = clampText(index >= 0 ? source.text.slice(index + head.length) : source.text);
    if (!remainder) {
      return {
        text: `This section works alongside "${outcomeText(0)}" from your own reading; the linked source's opening sentence is held back for a practice card.`,
        locator: "generated summary (the source has no text after its opening sentence)",
      };
    }
    return { text: remainder, locator: `after the opening sentence (first ${remainder.length} characters of the remainder)` };
  };
  // Fair distribution: source j teaches in lesson (j mod lesson count), each
  // lesson capped at 8 sections; a lesson no source reached (fewer sources
  // than lessons) gets an honest generated-summary section so every plan
  // lesson stays present with at least one section.
  const buckets: Array<Array<{ position: number; text: string }>> = Array.from({ length: lessonCount }, () => []);
  for (const source of usableSources) buckets[source.position % lessonCount].push(source);
  const fallbackSection = (lessonIndex: number) => usableSources.length
    ? {
      text: `This lesson covers ${outcomeText(lessonIndex)}.`,
      sourcePosition: usableSources[lessonIndex % usableSources.length].position,
      locator: "generated summary (no dedicated source reached this lesson)",
    }
    : {
      text: `This lesson covers ${outcomeText(lessonIndex)}.`,
      sourcePosition: 0,
      locator: "generated summary (no excerpt text reached the prompt)",
    };
  const draftLessons = buckets.map((bucket, lessonIndex) => ({
    // Epic-2 S4 treatment framing: deterministic per-track prose over the
    // lesson's own plan title AND outcome keyphrase — the ONLY track-dependent
    // field; sections stay byte-identical across tracks.
    framing: framingFor({
      track,
      lessonNumber: lessonIndex + 1,
      title: lessonTitles[lessonIndex] ?? "this lesson",
      outcome: outcomeText(lessonIndex),
    }),
    sections: bucket.length
      ? bucket.slice(0, 8).map(source => ({ sourcePosition: source.position, ...sectionFor(source) }))
      : [fallbackSection(lessonIndex)],
  }));
  // One optional enrichment passage overall, from the LAST usable source
  // (withholding-aware: when that source is a card source, its remainder
  // after the held-back opening sentence is used, exactly like its sections).
  const last = usableSources[usableSources.length - 1];
  const enrichment = last ? { sourcePosition: last.position, ...sectionFor(last) } : undefined;
  return JSON.stringify({
    lessons: draftLessons,
    objectiveIndexes: cardsDraft.map(card => card.objectiveIndex),
    cards: cardsDraft,
    ...(enrichment ? { enrichment } : {}),
  });
}

export function createSyntheticCourseCompletion(): TextCompletionPort {
  return {
    complete: async (request: unknown): Promise<TextCompletionResult> => {
      const messages = (request as TextCompletionRequest)?.messages;
      if (!Array.isArray(messages) || messages.length < 1) {
        return { ok: false, error: { code: "invalid-input", message: "The synthetic fixture requires its own bounded prompt.", outcome: "not-dispatched" } };
      }
      return {
        ok: true,
        text: syntheticCourseDraft(messages as TextCompletionRequest["messages"]),
        provenance: { requestedModel: SYNTHETIC_COURSE_MODEL, returnedModel: SYNTHETIC_COURSE_MODEL },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}

import {
  SYNTHETIC_COURSE_MODEL,
  courseContentV2Schema,
  courseDraftV2Schema,
  readingItemFor,
  type CourseContentV2,
  type RecallFeedback,
} from "../../contracts/courses";
import type { Plan } from "../../contracts/setup";
import type { TextCompletionPort, TextCompletionRequest, TextCompletionResult } from "../../contracts/ai-provider";

// Pure prompt building, strict output validation and the deterministic local
// synthetic processor for the epic-2 course tracer. Epic-2 S3 (2.3) widened the
// reply from one lesson to the confirmed plan's FULL lesson set: the fixture
// distributes the acknowledged sources fairly across the plan's lessons and
// adds one labeled optional enrichment passage. No I/O anywhere: the caller
// supplies the confirmed plan, the stated goal/topic and the excerpt store's
// texts; everything here is deterministic and bounded. The synthetic completion
// implements TextCompletionPort over its own input messages so the worker stays
// identical in shape to runAiDraft — F-A can later swap the port for
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
export type CourseInput = { goal: string; topic: string; plan: Plan; excerpts: CourseSource[] };

const SYSTEM_PROMPT = [
  "You draft a source-linked mini-course inside a local learning prototype.",
  "Answer with STRICT JSON only: no prose, no markdown fences, no comments, no extra keys.",
  'The JSON object has exactly four keys: "lessons" (one object per listed plan lesson, IN LISTED ORDER — never fewer, never more, each with exactly "sections" (1 to 8 objects with exactly text (1-2000 characters, teaching prose grounded in the named source),',
  "sourcePosition (integer, the 0-based index into the listed sources the section teaches from) and locator (1-120 characters naming where in that source the text comes from, e.g. 'opening lines'))),",
  '"objectiveIndexes" (1 to 8 distinct integers, the 0-based indexes into the listed plan outcomes this course covers),',
  'and "recall" with exactly objectiveIndex (integer index into the listed plan outcomes), sourcePosition (integer index into the listed sources),',
  "locator (1-120 characters naming where in that source the canonical answer is stated),",
  "prompt (1-1200 characters, one free-recall question whose canonical short answer is stated verbatim in that source),",
  "answer (1-800 characters, the canonical short answer as stated in the source), rationale (1-800 characters explaining the answer per the source),",
  'and "enrichment" (OPTIONAL; include it only when the sources support one extra optional reading — an object with exactly sourcePosition (integer index into the listed sources),',
  "locator (1-120 characters naming where in that source the passage comes from) and text (1-2000 characters grounded in that source)).",
  "Lesson titles are taken from the plan itself and are NOT part of your reply. Base every section, the recall item and any enrichment on the provided sources; when the sources do not cover something, do not invent it — teach only what they state.",
].join(" ");

// Bounded system+user message pair over the confirmed plan's exact FULL lesson
// list, outcomes and the acknowledged excerpts (fair byte shares as in the
// ai-setup builder, with the truncation stated plainly in the prompt).
export function buildCourseMessages(input: CourseInput) {
  const lessons = input.plan.miniCourse.lessons;
  const header = [
    `Stated learning goal: ${input.goal || "(none stated)"}`,
    `Stated topic: ${input.topic || "(none stated)"}`,
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
    'Return ONLY the JSON object with "lessons", "objectiveIndexes", "recall" and (when supported) "enrichment".',
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

export type CourseParse = { ok: true; content: CourseContentV2 } | { ok: false };
export type CourseParseSource = { extractionId: string; filename: string };

// Strict validation of the processor reply against the CONFIRMED PLAN's own
// bounds: the draft must carry EXACTLY one lessons entry per plan lesson, in
// listed order — every lesson title is substituted from the plan itself, never
// taken from the reply; objective indexes and source positions must resolve;
// duplicate objective indexes and unresolved item links are rejected. Anything
// else — prose, wrong shapes, unresolved links — is an INVALID draft that
// fails honestly, never repaired into a course.
export function parseCourseOutput(
  text: string,
  bounds: { plan: Plan; sources: CourseParseSource[] },
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
  const shape = courseDraftV2Schema.safeParse(parsed);
  if (!shape.success) return { ok: false };
  const draft = shape.data;
  const planLessons = bounds.plan.miniCourse.lessons;
  if (draft.lessons.length !== planLessons.length) return { ok: false };
  if (new Set(draft.objectiveIndexes).size !== draft.objectiveIndexes.length) return { ok: false };
  for (const index of draft.objectiveIndexes) if (index >= bounds.plan.outcomes.length) return { ok: false };
  const resolve = (position: number) => bounds.sources[position] ?? null;
  const lessons: CourseContentV2["lessons"] = [];
  for (const [index, lesson] of draft.lessons.entries()) {
    const sections: CourseContentV2["lessons"][number]["sections"] = [];
    for (const section of lesson.sections) {
      const source = resolve(section.sourcePosition);
      if (!source) return { ok: false };
      sections.push({ text: section.text, sourceRef: { extractionId: source.extractionId, filename: source.filename, locator: section.locator } });
    }
    lessons.push({
      title: planLessons[index],
      sections,
      items: [readingItemFor(index, planLessons[index])],
    });
  }
  const recallSource = resolve(draft.recall.sourcePosition);
  if (!recallSource || draft.recall.objectiveIndex >= bounds.plan.outcomes.length) return { ok: false };
  let enrichment: CourseContentV2["enrichment"];
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
  const content = {
    contentVersion: 2 as const,
    lessons,
    objectives: draft.objectiveIndexes.map(index => ({ index, text: bounds.plan.outcomes[index] })),
    recall: {
      objectiveIndex: draft.recall.objectiveIndex,
      sourceRef: { extractionId: recallSource.extractionId, filename: recallSource.filename, locator: draft.recall.locator },
      prompt: draft.recall.prompt,
      answer: draft.recall.answer,
      rationale: draft.recall.rationale,
    },
    ...(enrichment ? { enrichment } : {}),
  };
  const settled = courseContentV2Schema.safeParse(content);
  return settled.success ? { ok: true, content: settled.data } : { ok: false };
}

// Honest free-text judgement for the recall tracer: a normalized exact match,
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

export function buildRecallFeedback(input: {
  rootId: string;
  revision: number;
  courseId: string;
  content: CourseContentV2;
  attempted: string;
}): RecallFeedback {
  const recall = input.content.recall;
  return {
    rootId: input.rootId,
    revision: input.revision,
    courseId: input.courseId,
    outcome: judgeRecall(input.attempted, recall.answer),
    attempted: input.attempted,
    answer: recall.answer,
    rationale: recall.rationale,
    source: { filename: recall.sourceRef.filename, locator: recall.sourceRef.locator },
  };
}

// ---------------------------------------------------------------------------
// The local synthetic generation fixture. A PURE function of its own input
// messages: deterministic, no I/O, no config reads, zero-token usage (honest
// accounting — never fabricated counts). It reads the same bounded prompt the
// builder produced (indexed lessons, indexed outcomes, positioned sources) and
// emits a v2 draft the strict parser above accepts for those bounds: every
// plan lesson present in order, sources distributed fairly across the lessons
// (round-robin by source position; each lesson capped at 8 sections), and one
// labeled optional enrichment passage when a source supports it.
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
  const lessonCount = Math.max(1, Math.min(8, [...header.matchAll(/^lesson (\d+): /gmu)].length));
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
  const primarySource = usableSources[0];
  // The recall's canonical answer is the primary source's opening sentence, so
  // that source's sections teach from the REMAINDER after it: no served course
  // text (sections or enrichment) may quote the withheld answer — the frozen
  // boundary says the answer is never present in any GET payload. When the
  // remainder is empty the text falls back to a non-quoting summary sentence.
  const primaryHead = primarySource ? firstSentence(primarySource.text) : "";
  const sectionFor = (source: { position: number; text: string }): { text: string; locator: string } => {
    const opening = clampText(source.text);
    if (!primarySource || source.position !== primarySource.position || !primaryHead) {
      return { text: opening, locator: `opening excerpt (first ${opening.length} characters)` };
    }
    const index = source.text.indexOf(primaryHead);
    const remainder = clampText(index >= 0 ? source.text.slice(index + primaryHead.length) : source.text);
    if (!remainder) {
      return {
        text: `This section works alongside "${outcomeText(0)}" from your own reading; the linked source's opening sentence is held back for the recall item.`,
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
    sections: bucket.length
      ? bucket.slice(0, 8).map(source => ({ sourcePosition: source.position, ...sectionFor(source) }))
      : [fallbackSection(lessonIndex)],
  }));
  // One optional enrichment passage overall, from the LAST usable source
  // (withholding-aware: when that source IS the primary, its remainder after
  // the held-back opening sentence is used, exactly like its lesson sections).
  const last = usableSources[usableSources.length - 1];
  const enrichment = last ? { sourcePosition: last.position, ...sectionFor(last) } : undefined;
  const recallAnswer = primarySource ? firstSentence(primarySource.text) : primaryOutcome.text;
  return JSON.stringify({
    lessons: draftLessons,
    objectiveIndexes: (usableOutcomes.length >= 1 ? usableOutcomes : [{ index: 0, text: primaryOutcome.text }]).map(outcome => outcome.index),
    recall: {
      objectiveIndex: primaryOutcome.index,
      sourcePosition: primarySource?.position ?? 0,
      locator: primarySource ? `opening excerpt (first ${firstSentence(primarySource.text).length} characters)` : "plan outcome (no excerpt text reached the prompt)",
      prompt: `From memory, state the key point your source gives for: ${primaryOutcome.text}`,
      answer: recallAnswer,
      rationale: primarySource
        ? `The opening of ${primarySource.name} states this directly.`
        : "No source excerpt reached the bounded prompt; the confirmed plan's outcome is the reference.",
    },
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

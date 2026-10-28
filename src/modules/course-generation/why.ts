import {
  SYNTHETIC_WHY_MODEL,
  MAX_WHY_DEPTH,
  whyDimensionForDepth,
  whyDraftSchema,
  whyExplanationSchema,
  type CourseContentServing,
  type CourseSection,
  type WhyDimension,
  type WhyExplanation,
  type WhySource,
} from "../../contracts/courses";
import type { TextCompletionPort, TextCompletionRequest, TextCompletionResult } from "../../contracts/ai-provider";
import { firstJsonObject } from "./generation";

// Epic-2 S6 pure domain: learner-controlled why exploration with honest
// stopping. Three halves live here and nothing else:
//
//   1. Deterministic EVIDENCE AVAILABILITY over the stored course content plus
//      the verified supplements of the latest settled supplement pass. The
//      service computes it BEFORE any dispatch, so exhaustion is a structural
//      precondition, never a worker outcome — the stepper never offers a level
//      it cannot ground and no invented cause exists anywhere.
//   2. The bounded why prompt and its STRICT parser: the draft's dimension is
//      DERIVED from the requested depth (fixed sequencing), every citation is
//      resolved against the lesson's own sections and the VERIFIED supplement
//      records (never trusted from output), and restatement-shaped prose —
//      every substantive sentence copied from the lesson's own section/framing
//      text — is rejected, never repaired.
//   3. The zero-egress local synthetic FIXTURE completion that derives its
//      levels from the actual stored evidence only (the prompt's own piece
//      listing), deterministic and zero-token like the course/proposal
//      fixtures.
//
// No I/O anywhere: the caller supplies the serving content, the verified
// supplement records and the excerpt-free metadata the fixture reads back from
// its own bounded prompt.

// ---------------------------------------------------------------------------
// Evidence availability. Documented rule (frozen in the unit tests):
//
//   The evidence pool of ONE lesson is that lesson's own sections (each a
//   distinct source passage with its own locator) plus the course's VERIFIED
//   supplements — supplement records of the latest settled pass whose outcome
//   is 'supported' or 'conflict', the two outcomes that carry a checked
//   passage. The pool's FIRST piece grounds the lesson text itself (the base
//   reading); each FURTHER piece grounds one deeper level under the fixed
//   dimension sequencing (level 1 purpose, level 2 assumptions/trade-offs).
//
//   availableWhyDepth = min(MAX_WHY_DEPTH, max(0, pieces − 1))
//
// A single-section lesson with no verified supplements therefore offers NO
// deeper level (depth 0 — honest, not an error), and availability can grow
// when a supplement pass verifies passages. The rule is pure and total over
// any serving content (legacy v1–v3 rows included — their lessons derive
// levels from their own stored evidence exactly the same way).
// ---------------------------------------------------------------------------

// The minimal verified-supplement projection availability and citation
// resolution need (a filtered view of the S2 records; 'unsupported' rows carry
// no passage and never ground depth).
export type WhySupplementPiece = {
  outcome: string;
  url: string;
  origin: string;
  locator: string | null;
  passage: string | null;
};

export function availableWhyDepth(
  content: CourseContentServing,
  lessonIndex: number,
  supplements: readonly WhySupplementPiece[],
): number {
  const lesson = content.lessons[lessonIndex];
  if (!lesson) return 0;
  const verified = supplements.filter(piece => piece.outcome === "supported" || piece.outcome === "conflict").length;
  const pieces = lesson.sections.length + verified;
  return Math.min(MAX_WHY_DEPTH, Math.max(0, pieces - 1));
}

// ---------------------------------------------------------------------------
// The bounded why prompt. It carries only the consented v7 categories: the
// lesson summary (title), bounded source excerpts of the lesson's own sections
// and the verified supplement passages, plus the requested depth and its fixed
// dimension. The piece listing is structured (`piece N | kind | identity …`)
// so the deterministic fixture can read it back exactly.
// ---------------------------------------------------------------------------

const PIECE_EXCERPT_CHARS = 200;

export type WhyPromptInput = {
  lessonIndex: number;
  lessonTitle: string;
  depth: number;
  sections: CourseSection[];
  supplements: WhySupplementPiece[];
};

const WHY_SYSTEM_PROMPT = [
  "You draft ONE deeper explanation (a why step) for one lesson of a local learning prototype.",
  "Answer with STRICT JSON only: no prose, no markdown fences, no comments, no extra keys.",
  'The JSON object has exactly two keys: "explanation" (1-2000 characters of NEW prose addressing the requested dimension — purpose, or assumptions and trade-offs — BEYOND restating the lesson: never copy a sentence from the listed pieces)',
  'and "citations" (1 to 4 objects naming the pieces you ground the explanation in, each exactly {"kind":"lesson"|"supplement","index":<piece index>}).',
  "Teach only what the listed pieces state or jointly show; when they run out, say so plainly instead of inventing a cause.",
].join(" ");

function pieceLine(index: number, section: CourseSection): string {
  return `piece ${index} | lesson | ${section.sourceRef.filename} | ${section.sourceRef.locator}`;
}
function pieceLineSupplement(index: number, piece: WhySupplementPiece): string {
  return `piece ${index} | supplement | ${piece.origin} | ${piece.url} | ${piece.locator ?? "verified supplement record"}`;
}

export function buildWhyMessages(input: WhyPromptInput) {
  const dimension = whyDimensionForDepth(input.depth);
  const lines: string[] = [
    `Lesson (index ${input.lessonIndex}): ${input.lessonTitle}`,
    `Requested depth: ${input.depth} (${dimension})`,
    "Pieces of visible evidence (the lesson's own reading first):",
  ];
  const sections: string[] = [];
  const supplements: string[] = [];
  for (const [index, section] of input.sections.entries()) {
    lines.push(pieceLine(index, section));
    lines.push(`  excerpt: ${section.text.slice(0, PIECE_EXCERPT_CHARS)}`);
    sections.push(section.sourceRef.filename);
  }
  for (const [index, piece] of input.supplements.entries()) {
    const at = input.sections.length + index;
    lines.push(pieceLineSupplement(at, piece));
    lines.push(`  excerpt: ${(piece.passage ?? "").slice(0, PIECE_EXCERPT_CHARS)}`);
    supplements.push(piece.origin);
  }
  lines.push('Return ONLY the JSON object with "explanation" and "citations".');
  return [
    { role: "system" as const, content: WHY_SYSTEM_PROMPT },
    { role: "user" as const, content: lines.join("\n") },
  ];
}

// ---------------------------------------------------------------------------
// Restatement rejection. Deterministic check against the lesson's OWN text
// (its section texts plus its treatment framing): an explanation is
// restatement-shaped when EVERY substantive sentence (3+ words) appears inside
// the lesson's own text verbatim modulo case and whitespace runs. Partial
// reuse — a quoted phrase inside otherwise new prose — is allowed, exactly
// like the supplement verifier tolerates; a full copy is not.
// ---------------------------------------------------------------------------

function normalizeWhyText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

export function isRestatementOf(explanation: string, ownTexts: readonly string[]): boolean {
  const sentences = explanation
    .split(/[.!?]+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => (sentence.match(/[A-Za-z0-9']+/gu) ?? []).length >= 3);
  // No substantive sentence at all: the draft carries nothing beyond fragments.
  if (!sentences.length) return true;
  const haystack = normalizeWhyText(ownTexts.join("\n"));
  return sentences.every(sentence => haystack.includes(normalizeWhyText(sentence)));
}

// ---------------------------------------------------------------------------
// The strict parser. Bounds are the lesson's own sections and the VERIFIED
// supplement records; the dimension is DERIVED from the depth (never trusted
// from the reply); every citation must resolve to a real listed piece; the
// resolved source list is deduplicated; and the whole draft is rejected when
// its explanation is restatement-shaped against the lesson's own
// section/framing text. Anything else — prose, wrong shapes, unresolved links
// — is an INVALID draft that fails honestly, never repaired into a level.
// ---------------------------------------------------------------------------

export type WhyParseBounds = {
  depth: number;
  sections: CourseSection[];
  supplements: WhySupplementPiece[];
  // The lesson's own texts (section texts + framing) for restatement rejection.
  ownTexts: string[];
};

export type WhyParse = { ok: true; explanation: WhyExplanation } | { ok: false };

export function parseWhyOutput(text: string, bounds: WhyParseBounds): WhyParse {
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
  const shape = whyDraftSchema.safeParse(parsed);
  if (!shape.success) return { ok: false };
  const draft = shape.data;
  const dimension: WhyDimension = whyDimensionForDepth(bounds.depth);
  // Resolve every citation against the prompt's GLOBAL evidence listing — the
  // lesson's own sections first, the verified supplements continuing after
  // them — and deduplicate the resolved source list (kind + index). A
  // supplement citation naming a lesson piece index (or vice versa) is an
  // unresolved link: invalid, never repaired.
  const seen = new Set<string>();
  const sources: WhySource[] = [];
  for (const citation of draft.citations) {
    if (citation.kind === "lesson") {
      const section = bounds.sections[citation.index];
      if (!section) return { ok: false };
      const key = `lesson:${citation.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ kind: "lesson", filename: section.sourceRef.filename, locator: section.sourceRef.locator });
    } else {
      const relative = citation.index - bounds.sections.length;
      const piece = relative >= 0 ? bounds.supplements[relative] : undefined;
      if (!piece) return { ok: false };
      const key = `supplement:${citation.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ kind: "supplement", origin: piece.origin, url: piece.url, locator: piece.locator ?? "verified supplement record" });
    }
  }
  if (!sources.length) return { ok: false };
  if (isRestatementOf(draft.explanation, bounds.ownTexts)) return { ok: false };
  const settled = whyExplanationSchema.safeParse({ depth: bounds.depth, dimension, text: draft.explanation, sources });
  return settled.success ? { ok: true, explanation: settled.data } : { ok: false };
}

// ---------------------------------------------------------------------------
// The local synthetic why fixture. A PURE function of its own input messages
// (deterministic, zero-token, no I/O): it reads the bounded prompt's piece
// listing and composes the requested dimension's explanation from the ACTUAL
// stored evidence only — template prose over the real piece identities
// (filenames/locators/origins), never a copied section sentence, never an
// invented cause, and it cites the pieces it grounded itself in.
// ---------------------------------------------------------------------------

type PieceIdentity = { kind: "lesson" | "supplement"; label: string };

function fixturePieces(user: string): { depth: number; pieces: PieceIdentity[] } {
  const depth = Number(user.match(/^Requested depth: ([1-2]) \(/mu)?.[1] ?? 1);
  const pieces: PieceIdentity[] = [];
  for (const match of user.matchAll(/^piece (\d+) \| (lesson|supplement) \| (.+)$/gmu)) {
    const parts = match[3].split(" | ");
    if (match[2] === "lesson") pieces.push({ kind: "lesson", label: `${parts[0]} (${parts[1] ?? "locator"})` });
    else pieces.push({ kind: "supplement", label: `${parts[0]} (${parts[2] ?? parts[1] ?? "verified supplement record"})` });
  }
  return { depth, pieces };
}

function fixtureCitations(depth: number, pieces: PieceIdentity[]): Array<{ kind: "lesson" | "supplement"; index: number }> {
  // Level 1 grounds itself in the base reading plus the next piece; level 2
  // adds the piece after that (or falls back to the deepest piece present).
  const first = pieces[0];
  const second = pieces[1] ?? first;
  const third = depth >= 2 ? pieces[2] ?? second : second;
  const indexes = depth >= 2 ? [pieces.indexOf(first), pieces.indexOf(second), pieces.indexOf(third)] : [pieces.indexOf(first), pieces.indexOf(second)];
  return [...new Set(indexes)].filter(index => index >= 0).map(index => ({ kind: pieces[index].kind, index }));
}

export function syntheticWhyDraft(messages: TextCompletionRequest["messages"]): string {
  const user = [...messages].reverse().find(message => message.role === "user")?.content ?? "";
  const { depth, pieces } = fixturePieces(user);
  const first = pieces[0]?.label ?? "the lesson's own reading";
  const second = pieces[1]?.label ?? first;
  const third = pieces[2]?.label ?? second;
  const explanation = depth === 1
    ? `Purpose of this reading, grounded in its own pieces: ${first} carries the statement the lesson teaches from, and ${second} sits beside it to carry what that statement assumes in practice. The two are arranged together so one piece states the behavior and the other shows where it applies — the purpose of going deeper here is to see why both pieces are needed, which the lesson text itself does not restate.`
    : `Assumptions and trade-offs beneath the same reading: ${first} assumes its statement holds inside the scope it names, ${second} assumes the conditions it records are the ones that matter, and ${third} would only narrow the view further. The trade-off the arrangement accepts is visibility over depth — each piece is read for what it distinctly states, not for everything it could imply. Past these pieces the sources here are exhausted for this question; this level cites them so you can check every claim against where it comes from.`;
  return JSON.stringify({ explanation, citations: fixtureCitations(depth, pieces) });
}

export function createSyntheticWhyCompletion(): TextCompletionPort {
  return {
    complete: async (request: unknown): Promise<TextCompletionResult> => {
      const messages = (request as TextCompletionRequest)?.messages;
      if (!Array.isArray(messages) || messages.length < 1) {
        return { ok: false, error: { code: "invalid-input", message: "The synthetic fixture requires its own bounded prompt.", outcome: "not-dispatched" } };
      }
      return {
        ok: true,
        text: syntheticWhyDraft(messages as TextCompletionRequest["messages"]),
        provenance: { requestedModel: SYNTHETIC_WHY_MODEL, returnedModel: SYNTHETIC_WHY_MODEL },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}

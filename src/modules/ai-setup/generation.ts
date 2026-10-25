import { aiDraftResultSchema, type AiDraftResult } from "../../contracts/ai-setup";

// Pure prompt building and strict output validation for the S6 AI draft
// pipeline. No I/O: the caller supplies the acknowledged excerpts and the
// stated goal/topic; everything here is deterministic and bounded.

// Headroom under the adapter's 32 KiB aggregate input cap so the request can
// never be rejected for bounds after it was built honestly.
const TOTAL_CONTENT_BYTES = 30 * 1024;
const MIN_EXCERPT_BYTES = 256;

export type DraftSource = { name: string; text: string };
export type DraftInput = { goal: string; topic: string; excerpts: DraftSource[] };

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

const SYSTEM_PROMPT = [
  "You draft study plans inside a local learning prototype.",
  "Answer with STRICT JSON only: no prose, no markdown fences, no comments, no extra keys.",
  'The JSON object has exactly two keys: "topics" (an array of 3 to 6 distinct short candidate topics, each 1-160 characters)',
  'and "plan" with exactly the keys topic (1-160 characters), goal (one of "Exam preparation", "Understand a topic", "Apply a skill", "Other"),',
  "clarification (empty unless goal is Other, then 1-240 characters), outcomes (1 to 8 strings, each 1-300 characters),",
  "miniCourse with exactly title (1-160 characters), lessons (1 to 8 strings, each 1-200 characters), practice (1-1000 characters),",
  "estimatedMinutes (integer 1-600), and missingExplanations (1-1000 characters).",
  "The plan is a SUGGESTION the learner edits and confirms manually. Base everything on the provided sources; when the sources do not cover something, say so inside missingExplanations instead of inventing citations or facts.",
].join(" ");

// Bounded system+user message pair. Excerpts are truncated FAIRLY (equal byte
// shares; every source keeps a prefix) and the prompt states plainly that
// longer sources were cut, so the learner can see the prompt is partial. The
// caller adds maxOutputTokens (AI_BUDGET) and the adapter re-validates bounds.
export function buildDraftMessages(input: DraftInput) {
  const header = [
    `Stated learning goal: ${input.goal || "(none stated)"}`,
    `Stated topic: ${input.topic || "(none stated)"}`,
    "Acknowledged source excerpts follow.",
  ].join("\n");
  const reserved = byteLength(SYSTEM_PROMPT) + byteLength(header) + 512;
  const budget = Math.max(MIN_EXCERPT_BYTES, TOTAL_CONTENT_BYTES - reserved);
  const share = Math.max(MIN_EXCERPT_BYTES, Math.floor(budget / Math.max(1, input.excerpts.length)));
  let truncated = false;
  const sources: string[] = [];
  for (const excerpt of input.excerpts) {
    const bounded = truncateToBytes(excerpt.text, share);
    truncated ||= bounded.truncated;
    sources.push(`--- source: ${excerpt.name} ---\n${bounded.text}`);
  }
  const user = [
    header,
    ...sources,
    truncated ? "Note: one or more sources were longer than the bounded prompt and were truncated to fair prefixes; the omitted text was NOT sent." : null,
    "Return ONLY the JSON object with topics and plan.",
  ].filter((part): part is string => part !== null).join("\n\n");
  return [{ role: "system" as const, content: SYSTEM_PROMPT }, { role: "user" as const, content: user }];
}

export type DraftParse = { ok: true; result: AiDraftResult } | { ok: false };

// First balanced top-level JSON object in the text (string/escape aware).
// Reasoning models occasionally append a surplus brace or trailing noise; this
// recovers the complete object deterministically — no content is invented and
// the schema below still rejects anything malformed.
function firstJsonObject(text: string): string | null {
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

// Strict validation of the provider reply: at most one fenced ```json block is
// tolerated around a single JSON object; anything else — prose, multiple
// blocks, wrong shapes, out-of-bounds topics/plan — is an INVALID draft, never
// a confident plan.
export function parseDraftOutput(text: string): DraftParse {
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
  const result = aiDraftResultSchema.safeParse(parsed);
  return result.success ? { ok: true, result: result.data } : { ok: false };
}

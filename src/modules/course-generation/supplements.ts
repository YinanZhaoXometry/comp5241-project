import {
  SYNTHETIC_PROPOSAL_MODEL,
  supplementProposalDraftSchema,
  type CourseContentV2,
  type CourseGap,
  type CourseSection,
  type SupplementOutcome,
} from "../../contracts/courses";
import type { Plan } from "../../contracts/setup";
import type { TextCompletionPort, TextCompletionRequest, TextCompletionResult } from "../../contracts/ai-provider";
import {
  addressDenial,
  addressDenied,
  createBoundedFetch,
  publicAddress,
  validateFetchUrl,
  type AddressResolver,
  type BoundedFetchConfig,
  type BoundedFetchPort,
  type FetchTransport,
} from "../../adapters/source-fetch";
import { firstJsonObject } from "./generation";

// Epic-2 S2 pure domain: gap derivation, the supplement-proposal prompt and
// its strict parser, deterministic verification, conflict detection, and the
// zero-egress FIXTURE family (proposal completion + bounded fetch transport)
// that every automated gate and the default worker path run on. The two
// untrusted steps are kept structurally separate here: the processor only
// ever PROPOSES candidates (allowlisted host + path + claim + expected
// passage); verification is deterministic lexical code over the FETCHED
// bytes — an AI citation, a fetch success or model agreement is never
// verification. No I/O anywhere in this file except through the injected
// adapter boundary the fixture transport implements.

// ---------------------------------------------------------------------------
// Lexical helpers. Shared by the strict parser's claim-relevance check and
// the deterministic verifier; all pure, total and documented.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "your", "they", "them", "then",
  "than", "when", "what", "which", "where", "here", "there", "these", "those",
  "some", "such", "into", "over", "does", "been", "being", "because", "about",
  "appears", "appear", "yourself",
  // Function words the tokenizer's 3-character floor lets through; none of
  // them is ever a subject term (negators matter only in conflict detection).
  "not", "and", "but", "nor", "yet", "the", "for", "are", "was", "were", "has",
  "had", "one", "two", "can", "may", "must", "also", "only", "just", "how",
  "why", "who", "all", "any", "its", "you",
]);

// Whitespace-and-case normalization only: containment stays strict — the
// claimed passage must appear in the fetched content verbatim modulo case and
// whitespace runs, never paraphrased.
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/gu, " ");
}

// Light deterministic stem (ies→y, trailing s for length ≥ 5) so plural
// variants of one term count as the same term. Deliberately crude and total:
// false merges only weaken detection (never fabricate a conflict).
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function significantTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/gu) ?? []) {
    if (STOPWORDS.has(word)) continue;
    terms.add(stem(word));
  }
  return terms;
}

// Containment: the claimed passage exists inside the fetched content.
export function passageContained(passage: string, content: string): boolean {
  const needle = normalizeText(passage);
  if (!needle) return false;
  return normalizeText(content).includes(needle);
}

// Claim support: at least half of the claim's significant terms (and at
// least one) occur in the text being checked. A passage that exists but
// discusses something else does not support the gap.
export function claimSupported(claim: string, text: string): boolean {
  const claimTerms = significantTerms(claim);
  if (!claimTerms.size) return false;
  const textTerms = significantTerms(text);
  let shared = 0;
  for (const term of claimTerms) if (textTerms.has(term)) shared += 1;
  return shared >= 1 && shared * 2 >= claimTerms.size;
}

const NEGATORS = new Set(["not", "no", "never", "cannot", "without", "dont", "doesnt", "isnt", "arent", "wont", "none"]);

function sentences(text: string): string[] {
  return text.split(/[.!?]+/u).map(sentence => sentence.trim()).filter(Boolean);
}
function negated(sentence: string): boolean {
  return (sentence.toLowerCase().match(/[a-z']+/gu) ?? []).some(word => NEGATORS.has(word));
}

// Conflict detection: an upload sentence and a supplement passage sentence
// share at least two significant terms while exactly one side negates — the
// two sources then disagree on the same subject and both are shown side by
// side, never resolved. Everything else (including uncertainty) stays
// 'supported': a missed conflict leaves the upload's own lesson text visible,
// while a guessed conflict would misrepresent a source.
export function conflictsWithUpload(passage: string, uploadExcerpt: string): boolean {
  for (const supplementSentence of sentences(passage)) {
    const supplementTerms = significantTerms(supplementSentence);
    if (supplementTerms.size < 2) continue;
    const supplementNegated = negated(supplementSentence);
    for (const uploadSentence of sentences(uploadExcerpt)) {
      const uploadTerms = significantTerms(uploadSentence);
      if (uploadTerms.size < 2) continue;
      let shared = 0;
      for (const term of supplementTerms) if (uploadTerms.has(term)) shared += 1;
      if (shared >= 2 && supplementNegated !== negated(uploadSentence)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gap derivation: server-side, from the CONFIRMED PLAN's own
// missingExplanations — the gaps a supplement pass may address are declared
// by the plan, never invented by the processor.
// ---------------------------------------------------------------------------

const MAX_GAPS = 8;

// The plan's DECLARED gap total (before the release's 8-gap cap) — carried
// through the supplement state so the UI can state truncation honestly.
export function declaredGapCount(plan: Plan): number {
  return plan.missingExplanations
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0)
    .length;
}

// Accepts the serving shape (epic-2 S3 storedCourseContent — v2 native or the
// wrapped legacy single lesson); only the course-level objectives feed the
// outcome roll.
export function deriveGaps(plan: Plan, content: CourseContentV2): CourseGap[] {
  return plan.missingExplanations
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0)
    .slice(0, MAX_GAPS)
    .map((description, index) => ({
      index,
      description,
      objective: plan.outcomes[index % plan.outcomes.length] ?? content.objectives[0]?.text ?? "",
    }));
}

// ---------------------------------------------------------------------------
// Proposal prompt (bounded) and the strict parser. The prompt carries the
// consented v6 categories only: gap descriptions, the lesson summary
// (title + bounded upload section excerpts with their sources) and the
// allowlisted hosts — never raw excerpt stores beyond what the generated
// lesson already quotes.
// ---------------------------------------------------------------------------

const SECTION_EXCERPT_CHARS = 200;

export type ProposalInput = {
  lessonTitle: string;
  gaps: CourseGap[];
  outcomes: string[];
  // The course's upload sections in sequence order (epic-2 S3 flattens the
  // lessons' sections — a wrapped legacy course contributes its single list).
  sections: CourseSection[];
  allowlist: readonly string[];
};

const PROPOSAL_SYSTEM_PROMPT = [
  "You propose candidate public reference sources for a learner's declared plan gaps inside a local learning prototype.",
  "Answer with STRICT JSON only: no prose, no markdown fences, no comments, no extra keys.",
  'The JSON object has exactly one key "candidates": one object per listed gap, in gap order, each with exactly:',
  "gapIndex (integer, the listed gap index), host (exactly one of the allowlisted hosts), path (a short /notes/… slug path built from the gap's own words),",
  "claim (1-300 characters restating that gap's own description), expectedPassage (1-2000 characters quoting a passage you expect verbatim on that source's page),",
  "outcomeIndex (integer index into the listed outcomes this gap serves), sectionIndex (integer index into the listed upload sections the candidate speaks to).",
  "Propose only pages a public reference plausibly hosts. You never verify anything — verification is separate deterministic code over the fetched bytes.",
].join(" ");

export function buildProposalMessages(input: ProposalInput) {
  const header = [
    `Allowlisted public source hosts (use exactly one per candidate): ${input.allowlist.join(" ")}`,
    `Generated lesson (context only): ${input.lessonTitle}`,
    "Gaps (answer EVERY gap with exactly one candidate):",
    ...input.gaps.map(gap => `gap ${gap.index}: ${gap.description} (outcome ${gap.index % Math.max(1, input.outcomes.length)})`),
    "Lesson outcomes (index: text):",
    ...input.outcomes.map((outcome, index) => `${index}: ${outcome}`),
    "Upload sections the supplements speak to (index (source): excerpt):",
    ...input.sections.map((section, index) =>
      `section ${index} (${section.sourceRef.filename} · ${section.sourceRef.locator}): ${section.text.slice(0, SECTION_EXCERPT_CHARS)}`),
    'Return ONLY the JSON object with "candidates".',
  ].join("\n");
  return [
    { role: "system" as const, content: PROPOSAL_SYSTEM_PROMPT },
    { role: "user" as const, content: header },
  ];
}

export type ResolvedCandidate = {
  gap: CourseGap;
  url: string;
  // The gap's OWN description is the canonical claim; the model's restatement
  // is validated for relevance but never trusted downstream.
  claim: string;
  expectedPassage: string;
  outcomeText: string;
  uploadExcerpt: string;
  uploadSource: string;
};

export type ProposalBounds = {
  gaps: CourseGap[];
  outcomes: string[];
  sections: CourseSection[];
  allowlist: readonly string[];
};

export type ProposalParse = { ok: true; candidates: ResolvedCandidate[] } | { ok: false };

// Strict validation of the proposal reply against the plan's declared gaps,
// the course's own outcomes/sections and the fetch allowlist: candidate count
// and gap coverage must match exactly, hosts must be allowlisted, path
// segments must be clean, the claim must actually restate its gap, and every
// index must resolve. Anything else is an INVALID proposal that fails
// honestly, never repaired into candidates.
export function parseProposalOutput(text: string, bounds: ProposalBounds): ProposalParse {
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
  const shape = supplementProposalDraftSchema.safeParse(parsed);
  if (!shape.success) return { ok: false };
  const drafts = shape.data.candidates;
  if (drafts.length !== bounds.gaps.length) return { ok: false };
  const gapByIndex = new Map(bounds.gaps.map(gap => [gap.index, gap]));
  const seen = new Set<number>();
  const candidates: ResolvedCandidate[] = [];
  for (const draft of drafts) {
    const gap = gapByIndex.get(draft.gapIndex);
    if (!gap || seen.has(draft.gapIndex)) return { ok: false };
    seen.add(draft.gapIndex);
    if (!bounds.allowlist.some(entry => entry.toLowerCase() === draft.host)) return { ok: false };
    if (draft.path.split("/").some(segment => segment === "." || segment === "..")) return { ok: false };
    const url = `https://${draft.host}${draft.path}`;
    const target = validateFetchUrl(url, bounds.allowlist);
    if (!target.ok) return { ok: false };
    // The claim must restate its own gap (the model cannot smuggle in an
    // unrelated claim), and the indexes must resolve against the course.
    if (!claimRelevant(draft.claim, gap.description)) return { ok: false };
    if (draft.outcomeIndex >= bounds.outcomes.length) return { ok: false };
    const section = bounds.sections[draft.sectionIndex];
    if (!section) return { ok: false };
    candidates.push({
      gap,
      url: target.url.toString(),
      claim: gap.description,
      expectedPassage: draft.expectedPassage,
      outcomeText: bounds.outcomes[draft.outcomeIndex] ?? "",
      uploadExcerpt: section.text,
      uploadSource: `${section.sourceRef.filename} · ${section.sourceRef.locator}`,
    });
  }
  if (seen.size !== bounds.gaps.length) return { ok: false };
  return { ok: true, candidates };
}

// The parser's claim-relevance gate: at least half of the gap's significant
// terms (minimum one) occur in the restated claim.
function claimRelevant(claim: string, gapDescription: string): boolean {
  return claimSupported(gapDescription, claim);
}

// ---------------------------------------------------------------------------
// Deterministic verification over FETCHED bytes. Order matters and is
// structural: containment first (the passage must exist in the fetched
// content), then claim support (it must discuss the gap), then conflict
// detection against the upload excerpt the candidate spoke to.
// ---------------------------------------------------------------------------

export type VerifiedSupplement = {
  outcome: SupplementOutcome;
  passage: string | null;
  locator: string | null;
  conflict: { uploadExcerpt: string; uploadSource: string } | null;
};

export function verifySupplement(candidate: ResolvedCandidate, fetchedText: string): VerifiedSupplement {
  if (!passageContained(candidate.expectedPassage, fetchedText)) {
    // Honest unsupported state: the claimed passage was checked against the
    // fetched source and NOT found — no content persists, no scored item.
    return { outcome: "unsupported", passage: null, locator: null, conflict: null };
  }
  if (!claimSupported(candidate.claim, candidate.expectedPassage)) {
    return { outcome: "unsupported", passage: null, locator: null, conflict: null };
  }
  const locator = `fetched document, normalized characters ${locatePassage(candidate.expectedPassage, fetchedText)}`;
  if (conflictsWithUpload(candidate.expectedPassage, candidate.uploadExcerpt)) {
    return {
      outcome: "conflict",
      passage: candidate.expectedPassage,
      locator,
      conflict: { uploadExcerpt: candidate.uploadExcerpt, uploadSource: candidate.uploadSource },
    };
  }
  return { outcome: "supported", passage: candidate.expectedPassage, locator, conflict: null };
}

function locatePassage(passage: string, content: string): string {
  const haystack = normalizeText(content);
  const needle = normalizeText(passage);
  const at = haystack.indexOf(needle);
  return at < 0 ? "0–0" : `${at}–${at + needle.length}`;
}

// ---------------------------------------------------------------------------
// The zero-egress FIXTURE family. The bounded fetcher's validation logic runs
// FOR REAL in this mode (URL shape, allowlist, per-redirect revalidation,
// IP-range denial, streamed byte cap) — only the network transport and the
// DNS resolver are deterministic fakes, so no packet ever leaves the machine.
// Marker words inside a gap description select fixture rows so every display
// state is reachable without egress (docs/bounded-source-fetch.md).
// ---------------------------------------------------------------------------

export const FIXTURE_FETCH_ALLOWLIST = ["docs.example.org", "standards.example.org", "guide.example.org", "rebind.example.org"] as const;
export const FIXTURE_FETCH_CONFIG: BoundedFetchConfig = {
  allowlist: FIXTURE_FETCH_ALLOWLIST,
  maxBytes: 128 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 2,
};
// Synthetic PUBLIC addresses (documentation range 203.0.113/24). The one
// deliberately private entry demonstrates the allowlisted-name /
// private-address (rebinding) denial through the real validation path.
const FIXTURE_ADDRESSES: Record<string, string> = {
  "docs.example.org": "203.0.113.10",
  "standards.example.org": "203.0.113.11",
  "guide.example.org": "203.0.113.12",
  "rebind.example.org": "10.0.0.7",
};

export const FIXTURE_RESOLVE: AddressResolver = async host => {
  if (host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/u.test(host)) {
    if (!publicAddress(host)) throw addressDenied(addressDenial(host) ?? "ip");
    return host;
  }
  const address = FIXTURE_ADDRESSES[host];
  if (!address) throw new Error("Unknown fixture host");
  if (!publicAddress(address)) throw addressDenied(addressDenial(address) ?? "ip");
  return address;
};

const MARKER_MATCHERS: Array<{ marker: string; pattern: RegExp }> = [
  { marker: "conflicting", pattern: /\bconflicting\b/iu },
  { marker: "unverifiable", pattern: /\bunverifiable\b/iu },
  { marker: "unfetchable", pattern: /\bunfetchable\b/iu },
  { marker: "oversized", pattern: /\boversized\b/iu },
  { marker: "redirected", pattern: /\bredirected\b/iu },
  { marker: "rebinding", pattern: /\brebinding\b/iu },
  { marker: "looping", pattern: /\blooping\b/iu },
];
const MARKER_SEGMENTS = new Set(MARKER_MATCHERS.map(item => item.marker));

// First matching marker word wins (single-marker fixtures only).
export function fixtureMarkerFor(description: string): string | null {
  for (const item of MARKER_MATCHERS) if (item.pattern.test(description)) return item.marker;
  return null;
}

export function fixtureSlugFor(description: string): string {
  const words = (description.toLowerCase().match(/[a-z0-9]+/gu) ?? [])
    .filter(word => word.length >= 3 && !STOPWORDS.has(word) && !MARKER_SEGMENTS.has(word));
  return (words.length ? words : ["gap"]).join("-");
}

export function fixturePathFor(description: string): string {
  const marker = fixtureMarkerFor(description);
  return `/notes/${marker ? `${marker}/` : ""}${fixtureSlugFor(description)}`;
}

function fixtureSlugWords(url: URL): string[] {
  const segments = url.pathname.split("/").filter(Boolean);
  const slug = segments[segments.length - 1] ?? "gap";
  const words = slug.split("-").filter(word => word && !STOPWORDS.has(word) && !MARKER_SEGMENTS.has(word));
  return words.length ? words : ["gap"];
}

// The passage the synthetic proposal claims — identical derivation from the
// URL on both fixture sides, so the claimed passage is verifiably present for
// the supported/conflict rows and deliberately absent for the unsupported one.
export function fixtureClaimedPassageFor(url: URL): string {
  const words = fixtureSlugWords(url);
  if (url.pathname.startsWith("/notes/unverifiable/")) {
    return `Section 4 of this public reference answers the ${words.join(" ")} question with a worked example and a summary table.`;
  }
  const base = `Public reference note: ${words.join(" ")} — documented in this source with examples and background.`;
  if (url.pathname.startsWith("/notes/conflicting/")) {
    return `${base} Contrary to some uploaded notes, the public source states it is not the case that ${words.slice(0, 3).join(" ")} behave as those notes describe.`;
  }
  return base;
}

export function fixtureFetchedContentFor(url: URL): string {
  if (url.pathname.startsWith("/notes/unverifiable/")) {
    return "This public reference page covers a different topic in this release; see the site index for the full catalogue and later revisions.";
  }
  return `${url.hostname} — public reference page\n\n${fixtureClaimedPassageFor(url)}\n\nRetrieved through the local deterministic fetch fixture (zero egress).`;
}

function textBody(text: string): AsyncIterable<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return (async function* generator() { yield encoded; })();
}

function oversizeBody(bytes: number): AsyncIterable<Uint8Array> {
  return (async function* generator() {
    const chunk = new Uint8Array(64 * 1024).fill(46); // '.'
    let remaining = bytes;
    while (remaining > 0) {
      yield chunk.subarray(0, Math.min(chunk.length, remaining));
      remaining -= chunk.length;
    }
  })();
}

export const FIXTURE_TRANSPORT: FetchTransport = async url => {
  const path = url.pathname;
  if (path.startsWith("/notes/unfetchable/")) throw new Error("Fixture transport failure");
  if (path.startsWith("/notes/looping/")) return { status: 302, headers: { location: url.toString() }, body: textBody("") };
  if (path.startsWith("/notes/redirected/"))
    return { status: 302, headers: { location: `https://docs.example.org${path.replace("/notes/redirected/", "/notes/final/")}` }, body: textBody("") };
  if (path.startsWith("/notes/oversized/"))
    return { status: 200, headers: { "content-type": "text/plain" }, body: oversizeBody(FIXTURE_FETCH_CONFIG.maxBytes + 1) };
  return { status: 200, headers: { "content-type": "text/plain" }, body: textBody(fixtureFetchedContentFor(url)) };
};

// The DEFAULT fetch port of this build: the real bounded fetcher over the
// fixture transport/resolver. Zero egress; every denial path live.
export function createFixtureFetchPort(): BoundedFetchPort {
  return createBoundedFetch(FIXTURE_FETCH_CONFIG, { transport: FIXTURE_TRANSPORT, resolve: FIXTURE_RESOLVE });
}

// ---------------------------------------------------------------------------
// The local synthetic proposal processor. A PURE function of its own input
// messages (deterministic, zero-token, no I/O): reads the bounded prompt's
// gap/outcome/section listings and proposes one allowlisted candidate per gap
// whose expectedPassage is exactly what the fixture fetch port serves for
// that URL — except the documented marker rows.
// ---------------------------------------------------------------------------

export function syntheticProposalDraft(messages: TextCompletionRequest["messages"]): string {
  const user = [...messages].reverse().find(message => message.role === "user")?.content ?? "";
  const allow = (user.match(/^Allowlisted public source hosts \(use exactly one per candidate\): (.+)$/mu)?.[1] ?? "")
    .split(/\s+/u)
    .filter(Boolean);
  const gaps = [...user.matchAll(/^gap (\d+): (.+?) \(outcome (\d+)\)$/gmu)].map(match => ({
    index: Number(match[1]),
    description: match[2].trim(),
    outcomeIndex: Number(match[3]),
  }));
  const sectionCount = [...user.matchAll(/^section (\d+) \((.+?)\):/gmu)].length;
  const publicHosts = allow.filter(host => host !== "rebind.example.org");
  const candidates = gaps.map(gap => {
    const marker = fixtureMarkerFor(gap.description);
    const host = marker === "rebinding" ? "rebind.example.org" : publicHosts[gap.index % Math.max(1, publicHosts.length)] ?? "docs.example.org";
    const url = new URL(`https://${host}${fixturePathFor(gap.description)}`);
    return {
      gapIndex: gap.index,
      host,
      path: `${url.pathname}`,
      claim: gap.description,
      expectedPassage: fixtureClaimedPassageFor(url),
      outcomeIndex: gap.outcomeIndex,
      sectionIndex: sectionCount ? gap.index % sectionCount : 0,
    };
  });
  return JSON.stringify({ candidates });
}

export function createSyntheticProposalCompletion(): TextCompletionPort {
  return {
    complete: async (request: unknown): Promise<TextCompletionResult> => {
      const messages = (request as TextCompletionRequest)?.messages;
      if (!Array.isArray(messages) || messages.length < 1) {
        return { ok: false, error: { code: "invalid-input", message: "The synthetic fixture requires its own bounded prompt.", outcome: "not-dispatched" } };
      }
      return {
        ok: true,
        text: syntheticProposalDraft(messages as TextCompletionRequest["messages"]),
        provenance: { requestedModel: SYNTHETIC_PROPOSAL_MODEL, returnedModel: SYNTHETIC_PROPOSAL_MODEL },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}

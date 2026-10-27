import { describe, expect, it } from 'vitest';
import {
  MAX_WHY_DEPTH,
  SYNTHETIC_WHY_MODEL,
  WHY_QUEUE,
  requestWhySchema,
  whyDimensionForDepth,
  whyDraftSchema,
  whyExplanationSchema,
  whyJobSchema,
  type CourseContentV2,
  type CourseSection,
} from '../../src/contracts/courses';
import { textCompletionRequestSchema } from '../../src/contracts/ai-provider';
import { AI_BUDGET } from '../../src/adapters/ai-live';
import {
  availableWhyDepth,
  buildWhyMessages,
  createSyntheticWhyCompletion,
  isRestatementOf,
  parseWhyOutput,
  syntheticWhyDraft,
  type WhySupplementPiece,
} from '../../src/modules/course-generation/why';

// Epic-2 S6 pure halves: the documented deterministic availability rule, the
// fixed dimension sequencing, the bounded prompt, the strict parser
// (restatement rejection + global-index citation resolution) and the
// zero-egress synthetic fixture. Everything here is deterministic; no
// transport, no network, no provider.

const sectionOf = (text: string, name: string): CourseSection => ({
  text,
  sourceRef: { extractionId: crypto.randomUUID(), filename: name, locator: `opening lines of ${name}` },
});
const sections = [
  sectionOf('Unit testing checks a single unit of behavior.', 'notes.txt'),
  sectionOf('A test double stands in for a dependency.', 'doubles.txt'),
  sectionOf('Coverage reports executed lines, not assertion quality.', 'cover.txt'),
];
const contentOf = (lessonSections: CourseSection[]): CourseContentV2 => ({
  contentVersion: 2,
  lessons: [{ title: 'What a unit test is', sections: lessonSections, items: [{ id: 'lesson:1:reading', kind: 'reading', required: true, title: 'Read lesson 1: What a unit test is' }] }],
  objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
  recall: { objectiveIndex: 0, sourceRef: sections[0].sourceRef, prompt: 'p', answer: 'a', rationale: 'r' },
});
const supplement = (outcome: WhySupplementPiece['outcome']): WhySupplementPiece => ({
  outcome,
  url: 'https://docs.example.org/notes/x',
  origin: 'docs.example.org',
  locator: 'fetched document, normalized characters 10–240',
  passage: 'Public reference note: mock frameworks — documented with examples.',
});
const verified = [supplement('supported'), supplement('conflict')];

describe('documented availability rule: min(MAX, pieces − 1) over sections + verified supplements', () => {
  it('a single-section lesson with no verified supplements offers no deeper level (depth 0 — honest, not an error)', () => {
    expect(availableWhyDepth(contentOf([sections[0]]), 0, [])).toBe(0);
  });
  it('each further evidence piece grounds one deeper level: two sections → 1, three or more → 2 (the fixed cap)', () => {
    expect(availableWhyDepth(contentOf(sections.slice(0, 2)), 0, [])).toBe(1);
    expect(availableWhyDepth(contentOf(sections), 0, [])).toBe(2);
    const eight = Array.from({ length: 8 }, (_, index) => sectionOf(`Section number ${index} states its own point.`, `s${index}.txt`));
    expect(availableWhyDepth(contentOf(eight), 0, [])).toBe(MAX_WHY_DEPTH);
  });
  it('verified supplements count as evidence pieces: supported and conflict ground depth, unsupported never does', () => {
    expect(availableWhyDepth(contentOf([sections[0]]), 0, [supplement('supported')])).toBe(1);
    expect(availableWhyDepth(contentOf([sections[0]]), 0, verified)).toBe(2);
    expect(availableWhyDepth(contentOf([sections[0]]), 0, [supplement('unsupported')])).toBe(0);
    expect(availableWhyDepth(contentOf(sections.slice(0, 2)), 0, Array.from({ length: 5 }, () => supplement('unsupported')))).toBe(1);
  });
  it('is total: an unknown lesson index offers nothing', () => {
    expect(availableWhyDepth(contentOf(sections), 3, verified)).toBe(0);
  });
});

describe('fixed dimension sequencing', () => {
  it('level 1 is purpose, level 2 is assumptions/trade-offs; anything else is a contract violation', () => {
    expect(whyDimensionForDepth(1)).toBe('purpose');
    expect(whyDimensionForDepth(2)).toBe('assumptions-trade-offs');
    expect(() => whyDimensionForDepth(3)).toThrow();
    expect(() => whyDimensionForDepth(0)).toThrow();
  });
});

describe('bounded why prompt', () => {
  it('builds an adapter-valid system+user pair listing the lesson, the requested depth/dimension and the evidence pieces', () => {
    const messages = buildWhyMessages({ lessonIndex: 0, lessonTitle: 'What a unit test is', depth: 1, sections: sections.slice(0, 2), supplements: [verified[0]] });
    const request = textCompletionRequestSchema.safeParse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    expect(request.success).toBe(true);
    expect(messages[1].content).toContain('Lesson (index 0): What a unit test is');
    expect(messages[1].content).toContain('Requested depth: 1 (purpose)');
    expect(messages[1].content).toContain('piece 0 | lesson | notes.txt | opening lines of notes.txt');
    // Supplement pieces continue the GLOBAL numbering after the lesson sections.
    expect(messages[1].content).toContain('piece 2 | supplement | docs.example.org | https://docs.example.org/notes/x | fetched document, normalized characters 10–240');
    expect(messages[1].content).toContain('excerpt: Unit testing checks a single unit of behavior.');
  });
});

describe('strict why parser: restatement rejection and citation resolution', () => {
  const bounds = { depth: 1, sections, supplements: verified, ownTexts: sections.map(section => section.text) };
  const draft = (explanation: string, citations: Array<{ kind: string; index: number }>) => JSON.stringify({ explanation, citations });
  it('accepts new prose, derives the dimension from the depth and resolves lesson citations to visible sources', () => {
    const parsed = parseWhyOutput(draft('Purpose — an entirely new sentence about why the arrangement teaches.', [{ kind: 'lesson', index: 1 }]), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.explanation).toMatchObject({ depth: 1, dimension: 'purpose' });
    expect(parsed.explanation.sources).toEqual([{ kind: 'lesson', filename: 'doubles.txt', locator: 'opening lines of doubles.txt' }]);
  });
  it('resolves supplement citations by their GLOBAL piece index and deduplicates repeated citations', () => {
    const parsed = parseWhyOutput(draft('New prose again, grounded outside the uploads entirely here.', [
      { kind: 'supplement', index: 3 },
      { kind: 'supplement', index: 3 },
      { kind: 'lesson', index: 0 },
    ]), { ...bounds, depth: 2 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.explanation.dimension).toBe('assumptions-trade-offs');
    expect(parsed.explanation.sources).toEqual([
      { kind: 'supplement', origin: 'docs.example.org', url: 'https://docs.example.org/notes/x', locator: 'fetched document, normalized characters 10–240' },
      { kind: 'lesson', filename: 'notes.txt', locator: 'opening lines of notes.txt' },
    ]);
  });
  it('rejects prose, extra keys, empty citations and unresolved links — never repairs them', () => {
    expect(parseWhyOutput('trust me, purpose follows', bounds).ok).toBe(false);
    expect(parseWhyOutput('{"explanation":"New prose here.","citations":[{"kind":"lesson","index":0}],"extra":1}', bounds).ok).toBe(false);
    expect(parseWhyOutput('{"explanation":"New prose here.","citations":[]}', bounds).ok).toBe(false);
    expect(parseWhyOutput(draft('New prose here.', [{ kind: 'lesson', index: 9 }]), bounds).ok).toBe(false);
    // A supplement citation naming a lesson-range global index is unresolved.
    expect(parseWhyOutput(draft('New prose here.', [{ kind: 'supplement', index: 1 }]), bounds).ok).toBe(false);
    expect(parseWhyOutput(draft('New prose here.', [{ kind: 'supplement', index: 5 }]), bounds).ok).toBe(false);
    expect(parseWhyOutput(draft('New prose here.', [{ kind: 'bank', index: 0 }]), bounds).ok).toBe(false);
  });
  it('isRestatementOf: full sentence copies are restatement, new prose and partial quotes are not', () => {
    const own = ['Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.'];
    expect(isRestatementOf('Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.', own)).toBe(true);
    expect(isRestatementOf('UNIT   testing checks a single unit of behavior.', own)).toBe(true); // case/whitespace tolerant
    expect(isRestatementOf('Unit testing checks a single unit of behavior. But the purpose behind that split is a new claim.', own)).toBe(false);
    expect(isRestatementOf('An entirely new explanation of the purpose of the arrangement.', own)).toBe(false);
    // Degenerate drafts without one substantive sentence carry nothing beyond restatement.
    expect(isRestatementOf('Yes. Ok!', own)).toBe(true);
  });
  it('rejects restatement-shaped drafts against the lesson\'s own section/framing text', () => {
    // The whole explanation restates section 0 verbatim.
    expect(parseWhyOutput(draft(sections[0].text, [{ kind: 'lesson', index: 0 }]), bounds).ok).toBe(false);
    // Two copied sentences from two sections — still fully restatement.
    expect(parseWhyOutput(draft(`${sections[0].text} ${sections[1].text}`, [{ kind: 'lesson', index: 0 }]), bounds).ok).toBe(false);
    // A copied sentence plus one genuinely new sentence goes beyond restatement.
    expect(parseWhyOutput(draft(`${sections[0].text} The purpose of pairing these readings is comparison across sources.`, [{ kind: 'lesson', index: 0 }]), bounds).ok).toBe(true);
    // The framing paragraph is part of the lesson's own text too.
    const withFraming = { ...bounds, ownTexts: [...bounds.ownTexts, 'This lesson is presented directly as your sources state it.'] };
    expect(parseWhyOutput(draft('This lesson is presented directly as your sources state it.', [{ kind: 'lesson', index: 0 }]), withFraming).ok).toBe(false);
  });
});

describe('deterministic local synthetic why fixture', () => {
  const input = { lessonIndex: 0, lessonTitle: 'What a unit test is', sections, supplements: verified };
  it('returns a strict-parseable, zero-token, deterministic draft for both fixed depths', async () => {
    const port = createSyntheticWhyCompletion();
    for (const depth of [1, 2]) {
      const messages = buildWhyMessages({ ...input, depth });
      const request = textCompletionRequestSchema.parse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
      const first = await port.complete(request);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
      expect(first.provenance).toEqual({ requestedModel: SYNTHETIC_WHY_MODEL, returnedModel: SYNTHETIC_WHY_MODEL });
      const second = await port.complete(request);
      expect(second.ok && second.text).toBe(first.text); // pure function of the messages
      expect(syntheticWhyDraft(messages)).toBe(first.text);
      const parsed = parseWhyOutput(first.text, { depth, sections, supplements: verified, ownTexts: sections.map(section => section.text) });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.explanation.depth).toBe(depth);
      expect(parsed.explanation.dimension).toBe(whyDimensionForDepth(depth));
      // The fixture derives its levels from the actual stored evidence only:
      // every citation resolves and the prose never restates the lesson.
      expect(parsed.explanation.sources.length).toBeGreaterThanOrEqual(1);
      for (const source of parsed.explanation.sources) expect(source.kind === 'lesson' ? sections.some(section => section.sourceRef.filename === source.filename) : source.origin === 'docs.example.org').toBe(true);
    }
    // The two levels are DISTINCT non-restatement dimensions.
    const one = parseWhyOutput(syntheticWhyDraft(buildWhyMessages({ ...input, depth: 1 })), { depth: 1, sections, supplements: verified, ownTexts: sections.map(section => section.text) });
    const two = parseWhyOutput(syntheticWhyDraft(buildWhyMessages({ ...input, depth: 2 })), { depth: 2, sections, supplements: verified, ownTexts: sections.map(section => section.text) });
    expect(one.ok && two.ok && one.explanation.text !== two.explanation.text).toBe(true);
  });
  it('cites a verified supplement with its global piece index when the lesson has two sections', () => {
    const messages = buildWhyMessages({ ...input, depth: 2, sections: sections.slice(0, 2) });
    const parsed = parseWhyOutput(syntheticWhyDraft(messages), { depth: 2, sections: sections.slice(0, 2), supplements: verified, ownTexts: sections.map(section => section.text) });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Pieces 0/1 are the lesson sections; piece 2 is the first verified
    // supplement — the fixture's third citation resolves to it.
    expect(parsed.explanation.sources.some(source => source.kind === 'supplement' && source.origin === 'docs.example.org')).toBe(true);
  });
  it('rejects non-message input honestly without dispatching', async () => {
    const outcome = await createSyntheticWhyCompletion().complete({ messages: 'nope' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('invalid-input');
    expect(outcome.error.outcome).toBe('not-dispatched');
  });
});

describe('why command/job/stored envelopes stay strict', () => {
  it('the request envelope requires the course, lesson index and depth', () => {
    expect(requestWhySchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), lessonIndex: 0, depth: 1 }).success).toBe(true);
    expect(requestWhySchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), lessonIndex: 0 }).success).toBe(false);
    expect(requestWhySchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), lessonIndex: 8, depth: 1 }).success).toBe(false);
    expect(requestWhySchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), lessonIndex: -1, depth: 1 }).success).toBe(false);
    expect(requestWhySchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), lessonIndex: 0, depth: 9 }).success).toBe(false);
    expect(requestWhySchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), lessonIndex: 0, depth: 1, extra: 1 }).success).toBe(false);
  });
  it('the job envelope pins the level and the queue is the single recorded name', () => {
    expect(whyJobSchema.safeParse({ schemaVersion: 1, requestId: crypto.randomUUID(), admissionId: crypto.randomUUID(), courseId: crypto.randomUUID(), rootId: crypto.randomUUID(), ownerId: crypto.randomUUID(), sessionId: crypto.randomUUID(), lessonIndex: 1, depth: 2 }).success).toBe(true);
    expect(whyJobSchema.safeParse({ schemaVersion: 1, requestId: crypto.randomUUID(), admissionId: crypto.randomUUID(), courseId: crypto.randomUUID(), rootId: crypto.randomUUID(), ownerId: crypto.randomUUID(), sessionId: crypto.randomUUID(), lessonIndex: 1, depth: 3 }).success).toBe(false);
    expect(WHY_QUEUE).toBe('why-step-v1');
  });
  it('the stored explanation requires at least one resolved visible source', () => {
    expect(whyExplanationSchema.safeParse({ depth: 1, dimension: 'purpose', text: 'New prose.', sources: [{ kind: 'lesson', filename: 'notes.txt', locator: 'lines 1-2' }] }).success).toBe(true);
    expect(whyExplanationSchema.safeParse({ depth: 1, dimension: 'purpose', text: 'New prose.', sources: [] }).success).toBe(false);
    expect(whyExplanationSchema.safeParse({ depth: 3, dimension: 'purpose', text: 'New prose.', sources: [{ kind: 'lesson', filename: 'notes.txt', locator: 'lines 1-2' }] }).success).toBe(false);
    expect(whyExplanationSchema.safeParse({ depth: 1, dimension: 'mystery', text: 'New prose.', sources: [{ kind: 'lesson', filename: 'notes.txt', locator: 'lines 1-2' }] }).success).toBe(false);
    // The draft schema bounds the shapes the parser trusts (global piece indexes).
    expect(whyDraftSchema.safeParse({ explanation: 'New prose.', citations: [{ kind: 'lesson', index: 15 }] }).success).toBe(true);
    expect(whyDraftSchema.safeParse({ explanation: 'New prose.', citations: [{ kind: 'lesson', index: 16 }] }).success).toBe(false);
  });
});

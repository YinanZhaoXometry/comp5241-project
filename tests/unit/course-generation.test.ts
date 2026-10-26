import { describe, expect, it } from 'vitest';
import {
  buildCourseMessages,
  parseCourseOutput,
  judgeRecall,
  buildRecallFeedback,
  createSyntheticCourseCompletion,
  syntheticCourseDraft,
} from '../../src/modules/course-generation/generation';
import {
  buildProposalMessages,
  claimSupported,
  conflictsWithUpload,
  createSyntheticProposalCompletion,
  declaredGapCount,
  deriveGaps,
  parseProposalOutput,
  passageContained,
  syntheticProposalDraft,
  verifySupplement,
  type ResolvedCandidate,
} from '../../src/modules/course-generation/supplements';
import { courseContentSchema, courseDraftSchema, submitRecallSchema, SYNTHETIC_COURSE_MODEL, supplementJobSchema, requestSupplementsSchema, SUPPLEMENT_QUEUE } from '../../src/contracts/courses';
import { textCompletionRequestSchema } from '../../src/contracts/ai-provider';
import { AI_BUDGET } from '../../src/adapters/ai-live';
import type { Plan } from '../../src/contracts/setup';

// Local synthetic coverage of the epic-2 S1 course tracer's PURE halves:
// bounded prompt building, strict plan-bounds-checked output validation, the
// deterministic local synthetic processor and the recall judge. No transport,
// no network, no provider — everything here is deterministic.

const plan: Plan = {
  topic: 'Unit testing fundamentals',
  goal: 'Understand a topic',
  clarification: '',
  outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is', 'A second lesson for context'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const sources = [
  { extractionId: crypto.randomUUID(), filename: 'notes.txt' },
  { extractionId: crypto.randomUUID(), filename: 'doubles.txt' },
];
const excerpts = [
  { name: 'notes.txt', text: 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes. A unit test isolates the behavior under test.' },
  { name: 'doubles.txt', text: 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality. Doubles keep tests fast.' },
];
const bounds = { plan, sources };
const input = { goal: 'Exam preparation', topic: 'unit testing', plan, excerpts };

const validDraft = (extra: Record<string, unknown> = {}) => JSON.stringify({
  sections: [
    { text: 'A unit test isolates one behavior and asserts its outcome.', sourcePosition: 0, locator: 'opening lines' },
    { text: 'A test double stands in for a real dependency during the test.', sourcePosition: 1, locator: 'opening lines' },
  ],
  objectiveIndexes: [0, 1, 2],
  recall: { objectiveIndex: 0, sourcePosition: 0, locator: 'opening lines', prompt: 'State the three parts of the unit test structure.', answer: 'Arrange inputs, act, assert outcomes.', rationale: 'The opening of notes.txt states this directly.' },
  ...extra,
});

describe('bounded course prompt building', () => {
  it('builds a system+user pair that passes the adapter request contract under the token ceiling', () => {
    const messages = buildCourseMessages(input);
    const parsed = textCompletionRequestSchema.safeParse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    expect(parsed.success).toBe(true);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('0: Explain arrange-act-assert');
    expect(messages[1].content).toContain('--- source 0: notes.txt ---');
    expect(messages[1].content).toContain('Lesson title (taken from the plan, not returned): What a unit test is');
  });
  it('truncates over-long excerpts fairly, keeps every source present and states the cut', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ name: `s${index}.txt`, text: 'x'.repeat(64 * 1024) }));
    const messages = buildCourseMessages({ ...input, excerpts: many });
    const aggregate = messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.content, 'utf8'), 0);
    expect(aggregate).toBeLessThanOrEqual(32 * 1024);
    for (let index = 0; index < many.length; index += 1) expect(messages[1].content).toContain(`--- source ${index}: s${index}.txt ---`);
    expect(messages[1].content).toContain('were longer than the bounded prompt');
  });
});

describe('strict course output validation against the confirmed plan', () => {
  it('accepts a resolvable draft and substitutes the lesson title from the plan', () => {
    const parsed = parseCourseOutput(validDraft(), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.lessonTitle).toBe('What a unit test is'); // from the plan, never the reply
    expect(parsed.content.sections).toHaveLength(2);
    expect(parsed.content.sections[0].sourceRef).toMatchObject({ extractionId: sources[0].extractionId, filename: 'notes.txt' });
    expect(parsed.content.objectives.map(objective => objective.text)).toEqual(plan.outcomes);
    expect(parsed.content.recall.sourceRef.filename).toBe('notes.txt');
    expect(courseContentSchema.safeParse(parsed.content).success).toBe(true);
  });
  it('accepts a single fenced json block and recovers balanced objects from trailing noise', () => {
    expect(parseCourseOutput(`\`\`\`json\n${validDraft()}\n\`\`\``, bounds).ok).toBe(true);
    expect(parseCourseOutput(`${validDraft()}}}`, bounds).ok).toBe(true);
    expect(parseCourseOutput(`${validDraft()}\nNote: good luck!`, bounds).ok).toBe(true);
  });
  it('rejects prose, malformed JSON, extra keys, unresolved links and duplicate objectives', () => {
    expect(parseCourseOutput('Here is your lesson: ...', bounds).ok).toBe(false);
    expect(parseCourseOutput('{not json', bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ extra: 1 }), bounds).ok).toBe(false);
    // Objective index beyond the plan's outcomes.
    expect(parseCourseOutput(validDraft({ objectiveIndexes: [0, 1, 3] }), bounds).ok).toBe(false);
    // Source position beyond the selected sources.
    expect(parseCourseOutput(validDraft({ sections: [{ text: 'x', sourcePosition: 5, locator: 'l' }] }), bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ recall: { objectiveIndex: 9, sourcePosition: 0, locator: 'l', prompt: 'p', answer: 'a', rationale: 'r' } }), bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ recall: { objectiveIndex: 0, sourcePosition: 2, locator: 'l', prompt: 'p', answer: 'a', rationale: 'r' } }), bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ objectiveIndexes: [0, 0, 1] }), bounds).ok).toBe(false);
    expect(parseCourseOutput('', bounds).ok).toBe(false);
    // The draft schema itself bounds the shapes the parser trusts.
    expect(courseDraftSchema.safeParse({ sections: [], objectiveIndexes: [0], recall: {} }).success).toBe(false);
  });
});

describe('deterministic local synthetic processor', () => {
  it('returns a strict-parseable, zero-token, deterministic draft over its own messages', async () => {
    const port = createSyntheticCourseCompletion();
    const messages = buildCourseMessages(input);
    const request = textCompletionRequestSchema.parse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    const first = await port.complete(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(first.provenance).toEqual({ requestedModel: SYNTHETIC_COURSE_MODEL, returnedModel: SYNTHETIC_COURSE_MODEL });
    const second = await port.complete(request);
    expect(second.ok && second.text).toBe(first.text); // pure function of the input messages
    const parsed = parseCourseOutput(first.text, bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.lessonTitle).toBe('What a unit test is');
    expect(parsed.content.sections.length).toBeGreaterThanOrEqual(1);
    expect(parsed.content.sections[0].sourceRef.filename).toBe('notes.txt');
    expect(parsed.content.objectives.length).toBe(plan.outcomes.length);
    expect(parsed.content.recall.answer.length).toBeGreaterThanOrEqual(1);
  });
  it('rejects non-message input honestly without dispatching', async () => {
    const outcome = await createSyntheticCourseCompletion().complete({ messages: 'nope' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('invalid-input');
    expect(outcome.error.outcome).toBe('not-dispatched');
  });
  it('syntheticCourseDraft is stable for identical input and bounded in section length', () => {
    const messages = buildCourseMessages({ ...input, excerpts: [{ name: 'big.txt', text: 'z'.repeat(64 * 1024) }] });
    const a = syntheticCourseDraft(messages);
    const b = syntheticCourseDraft(messages);
    expect(a).toBe(b);
    const parsed = parseCourseOutput(a, { plan, sources: [sources[0]] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) for (const section of parsed.content.sections) expect(section.text.length).toBeLessThanOrEqual(480);
  });
  it('round-trips a legal 10-source selection: at most 8 sections, links resolve, no section quotes the recall answer', async () => {
    // The draft schema caps sections at 8 while a batch may select 10 — the
    // fixture must slice, never fail generation on a legal selection.
    const ten = Array.from({ length: 10 }, (_, index) => ({ name: `t${index}.txt`, text: `Source ${index} opens here. Source ${index} remainder continues the lesson body.` }));
    const tenSources = ten.map(excerpt => ({ extractionId: crypto.randomUUID(), filename: excerpt.name }));
    const messages = buildCourseMessages({ ...input, excerpts: ten });
    const request = textCompletionRequestSchema.parse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    const outcome = await createSyntheticCourseCompletion().complete(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const parsed = parseCourseOutput(outcome.text, { plan, sources: tenSources });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.sections).toHaveLength(8);
    expect(new Set(parsed.content.sections.map(section => section.sourceRef.extractionId)).size).toBe(8);
    // Withholding at the source: the recall's canonical answer (source 0's
    // opening sentence) appears in no served section text.
    for (const section of parsed.content.sections) expect(section.text).not.toContain(parsed.content.recall.answer);
    expect(parsed.content.sections[0].text).toContain('remainder continues the lesson body');
  });
});

describe('recall judgement and feedback', () => {
  it('judges normalized equality and substantial containment as correct, everything else as incorrect', () => {
    expect(judgeRecall('Arrange inputs, act, assert outcomes.', 'Arrange inputs, act, assert outcomes.')).toBe('correct');
    expect(judgeRecall('  arrange   INPUTS, act, assert outcomes.  ', 'Arrange inputs, act, assert outcomes.')).toBe('correct');
    expect(judgeRecall('First, arrange inputs, act, assert outcomes. Then clean up.', 'Arrange inputs, act, assert outcomes.')).toBe('correct');
    expect(judgeRecall('Assert nothing and hope.', 'Arrange inputs, act, assert outcomes.')).toBe('incorrect');
    expect(judgeRecall('', 'Arrange inputs, act, assert outcomes.')).toBe('incorrect');
  });
  it('feedback releases the canonical answer and source exactly once per submission', () => {
    const parsed = parseCourseOutput(validDraft(), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const feedback = buildRecallFeedback({ rootId: crypto.randomUUID(), revision: 3, courseId: crypto.randomUUID(), content: parsed.content, attempted: 'Arrange inputs, act, assert outcomes.' });
    expect(feedback.outcome).toBe('correct');
    expect(feedback.answer).toBe('Arrange inputs, act, assert outcomes.');
    expect(feedback.rationale).toContain('notes.txt');
    expect(feedback.source).toMatchObject({ filename: 'notes.txt', locator: 'opening lines' });
  });
  it('the recall command envelope requires attempted text and rejects control-shaped bodies', () => {
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attempted: 'an answer' }).success).toBe(true);
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 }).success).toBe(false);
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attempted: '' }).success).toBe(false);
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attempted: 'x', extra: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Epic-2 S2 pure halves: plan-owned gap derivation, the bounded proposal
// prompt + strict parser, deterministic verification/conflict detection, and
// the synthetic proposal fixture. Everything here is deterministic; no
// transport, no network, no provider.
// ---------------------------------------------------------------------------

const fixtureAllowlist = ['docs.example.org', 'standards.example.org', 'guide.example.org', 'rebind.example.org'] as const;
const gapsPlan: Plan = {
  ...plan,
  missingExplanations: 'Sources do not cover mock frameworks. A conflicting statement about doubles and dependencies appears in public documentation. One unverifiable claim exists about coverage.',
};
const sectionsOf = (draft: string) => parseCourseOutput(draft, bounds);

describe('plan-owned gap derivation', () => {
  it('splits the confirmed plan missingExplanations into ordered, outcome-linked gaps', () => {
    const parsed = sectionsOf(validDraft());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const gaps = deriveGaps(gapsPlan, parsed.content);
    expect(gaps.map(gap => gap.description)).toEqual([
      'Sources do not cover mock frameworks.',
      'A conflicting statement about doubles and dependencies appears in public documentation.',
      'One unverifiable claim exists about coverage.',
    ]);
    expect(gaps.every((gap, index) => gap.index === index)).toBe(true);
    // Outcome context rolls deterministically over the plan's own outcomes.
    expect(gaps[0].objective).toBe(plan.outcomes[0]);
    expect(gaps[1].objective).toBe(plan.outcomes[1]);
    expect(gaps[2].objective).toBe(plan.outcomes[2]);
  });
  it('splits only on sentence boundaries; fragments without one stay a single gap', () => {
    const parsed = sectionsOf(validDraft());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(deriveGaps({ ...plan, missingExplanations: 'One declared gap. A second declared gap! A third?' }, parsed.content)).toHaveLength(3);
    expect(deriveGaps({ ...plan, missingExplanations: 'A single declared gap without more' }, parsed.content)).toHaveLength(1);
  });
  it('caps supplementable gaps at 8 while declaredGapCount keeps the honest total', () => {
    const parsed = sectionsOf(validDraft());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const nine = Array.from({ length: 9 }, (_, index) => `Declared gap ${index + 1} stays open.`).join(' ');
    expect(declaredGapCount({ ...plan, missingExplanations: nine })).toBe(9);
    const gaps = deriveGaps({ ...plan, missingExplanations: nine }, parsed.content);
    expect(gaps).toHaveLength(8);
    expect(gaps[7].description).toContain('8');
  });
});

describe('bounded supplement proposal prompt and strict parser', () => {
  const parsed = sectionsOf(validDraft());
  if (!parsed.ok) throw new Error('fixture setup failed');
  const gaps = deriveGaps(gapsPlan, parsed.content);
  const proposalBounds = { gaps, outcomes: plan.outcomes, sections: parsed.content.sections, allowlist: fixtureAllowlist };
  it('builds an adapter-valid prompt that lists allowlist, gaps, outcomes and upload sections', () => {
    const messages = buildProposalMessages({ lessonTitle: parsed.content.lessonTitle, gaps, outcomes: plan.outcomes, sections: parsed.content.sections, allowlist: fixtureAllowlist });
    const request = textCompletionRequestSchema.safeParse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    expect(request.success).toBe(true);
    expect(messages[1].content).toContain('docs.example.org');
    expect(messages[1].content).toContain('gap 0: Sources do not cover mock frameworks.');
    expect(messages[1].content).toContain('section 0 (notes.txt');
    // The withheld recall answer and its rationale never ride the proposal prompt.
    expect(messages[1].content).not.toContain('Arrange inputs, act, assert outcomes.');
    expect(messages[1].content).not.toContain('The opening of notes.txt states this directly.');
  });
  it('accepts a complete, resolving proposal and canonicalizes the claim to the plan-owned gap text', () => {
    const proposal = JSON.stringify({
      candidates: gaps.map((gap, index) => ({
        gapIndex: index,
        host: 'docs.example.org',
        path: `/notes/gap-${index}`,
        claim: gap.description,
        expectedPassage: `Passage ${index} about ${gap.description}`,
        outcomeIndex: index,
        sectionIndex: index % parsed.content.sections.length,
      })),
    });
    const outcome = parseProposalOutput(proposal, proposalBounds);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(3);
    expect(outcome.candidates[0].claim).toBe('Sources do not cover mock frameworks.');
    expect(outcome.candidates[0].url).toBe('https://docs.example.org/notes/gap-0');
    expect(outcome.candidates[0].uploadSource).toContain('notes.txt');
  });
  it('rejects prose, partial coverage, duplicate/unknown gaps, unallowlisted hosts, dot-dot paths and drifting claims', () => {
    expect(parseProposalOutput('no json here', proposalBounds).ok).toBe(false);
    const forGaps = (count: number) => JSON.stringify({
      candidates: Array.from({ length: count }, (_, index) => ({
        gapIndex: index, host: 'docs.example.org', path: `/notes/g-${index}`, claim: gaps[index]?.description ?? 'x',
        expectedPassage: 'p', outcomeIndex: 0, sectionIndex: 0,
      })),
    });
    expect(parseProposalOutput(forGaps(2), proposalBounds).ok).toBe(false); // a gap left unanswered
    expect(parseProposalOutput(forGaps(4), proposalBounds).ok).toBe(false); // an invented gap
    const duplicate = JSON.stringify({
      candidates: [0, 0, 2].map(gapIndex => ({ gapIndex, host: 'docs.example.org', path: `/notes/g-${gapIndex}`, claim: gaps[gapIndex].description, expectedPassage: 'p', outcomeIndex: 0, sectionIndex: 0 })),
    });
    expect(parseProposalOutput(duplicate, proposalBounds).ok).toBe(false);
    const foreignHost = JSON.stringify({
      candidates: gaps.map((gap, index) => ({ gapIndex: index, host: 'evil.example.net', path: `/notes/g-${index}`, claim: gap.description, expectedPassage: 'p', outcomeIndex: 0, sectionIndex: 0 })),
    });
    expect(parseProposalOutput(foreignHost, proposalBounds).ok).toBe(false);
    const traversal = JSON.stringify({
      candidates: gaps.map((gap, index) => ({ gapIndex: index, host: 'docs.example.org', path: `/notes/../secret`, claim: gap.description, expectedPassage: 'p', outcomeIndex: 0, sectionIndex: 0 })),
    });
    expect(parseProposalOutput(traversal, proposalBounds).ok).toBe(false);
    const driftingClaim = JSON.stringify({
      candidates: gaps.map((gap, index) => ({ gapIndex: index, host: 'docs.example.org', path: `/notes/g-${index}`, claim: 'something completely unrelated indeed', expectedPassage: 'p', outcomeIndex: 0, sectionIndex: 0 })),
    });
    expect(parseProposalOutput(driftingClaim, proposalBounds).ok).toBe(false);
    const unresolved = JSON.stringify({
      candidates: gaps.map((gap, index) => ({ gapIndex: index, host: 'docs.example.org', path: `/notes/g-${index}`, claim: gap.description, expectedPassage: 'p', outcomeIndex: 9, sectionIndex: 0 })),
    });
    expect(parseProposalOutput(unresolved, proposalBounds).ok).toBe(false);
  });
});

describe('deterministic verification: containment, claim support, conflict', () => {
  it('containment is whitespace/case tolerant but never paraphrase tolerant', () => {
    expect(passageContained('Mock  frameworks\nAre documented', 'body text. MOCK   FRAMEWORKS\nARE DOCUMENTED. more')).toBe(true);
    expect(passageContained('mock frameworks are documented here', 'body says mock frameworks were documented elsewhere')).toBe(false);
  });
  it('claim support needs at least half of the claim terms present', () => {
    expect(claimSupported('Sources do not cover mock frameworks', 'mock frameworks are documented in this public reference')).toBe(true);
    expect(claimSupported('Sources do not cover mock frameworks', 'a completely different topic with other words entirely')).toBe(false);
  });
  it('conflict fires only on shared-subject polarity disagreement', () => {
    expect(conflictsWithUpload(
      'The public source states it is not the case that doubles and dependencies behave as those notes describe.',
      'A test double stands in for a dependency.',
    )).toBe(true);
    // Agreement on the same subject is not a conflict.
    expect(conflictsWithUpload(
      'Doubles and dependencies are documented in the public source.',
      'A test double stands in for a dependency.',
    )).toBe(false);
    // A negator on an unrelated subject is not a conflict.
    expect(conflictsWithUpload(
      'The catalogue does not include that chapter.',
      'A test double stands in for a dependency.',
    )).toBe(false);
  });
  it('verifySupplement resolves supported / conflict / unsupported in order', () => {
    const candidate = (passage: string, upload: string): ResolvedCandidate => ({
      gap: { index: 0, description: 'Sources do not cover mock frameworks', objective: '' },
      url: 'https://docs.example.org/notes/x',
      claim: 'Sources do not cover mock frameworks',
      expectedPassage: passage,
      outcomeText: '',
      uploadExcerpt: upload,
      uploadSource: 'notes.txt · lines 1-2',
    });
    const body = 'Public reference note: mock frameworks — documented with examples and background.';
    expect(verifySupplement(candidate(body, 'Arrange inputs, act, assert outcomes.'), body)).toMatchObject({ outcome: 'supported' });
    const conflictBody = 'Public reference note: mock frameworks — documented. It is not the case that mock frameworks behave as those notes describe.';
    expect(verifySupplement(candidate(conflictBody, 'Mock frameworks need a stub.'), conflictBody)).toMatchObject({ outcome: 'conflict' });
    expect(verifySupplement(candidate(body, 'Arrange inputs, act, assert outcomes.'), 'nothing matching here at all')).toMatchObject({ outcome: 'unsupported', passage: null, locator: null });
    // Passage exists but discusses something else: unsupported, never a stretch.
    expect(verifySupplement(candidate(body, 'Arrange inputs, act, assert outcomes.'), 'the weather in the catalogue today is fine and mild')).toMatchObject({ outcome: 'unsupported' });
  });
});

describe('deterministic local synthetic proposal fixture', () => {
  const parsed = sectionsOf(validDraft());
  if (!parsed.ok) throw new Error('fixture setup failed');
  const gaps = deriveGaps(gapsPlan, parsed.content);
  const proposalBounds = { gaps, outcomes: plan.outcomes, sections: parsed.content.sections, allowlist: fixtureAllowlist };
  const messages = buildProposalMessages({ lessonTitle: parsed.content.lessonTitle, gaps, outcomes: plan.outcomes, sections: parsed.content.sections, allowlist: fixtureAllowlist });
  it('returns a strict-parseable, zero-token, deterministic proposal over its own messages', async () => {
    const port = createSyntheticProposalCompletion();
    const request = textCompletionRequestSchema.parse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    const first = await port.complete(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const second = await port.complete(request);
    expect(second.ok && second.text).toBe(first.text); // pure function of the messages
    const outcome = parseProposalOutput(first.text, proposalBounds);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(gaps.length);
    expect(syntheticProposalDraft(messages)).toBe(first.text);
  });
  it('rejects non-message input honestly without dispatching', async () => {
    const outcome = await createSyntheticProposalCompletion().complete({ messages: 'nope' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('invalid-input');
    expect(outcome.error.outcome).toBe('not-dispatched');
  });
  it('the supplement command/job envelopes stay strict', () => {
    expect(SUPPLEMENT_QUEUE).toBe('supplement-fetch-v1');
    expect(requestSupplementsSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, courseId: crypto.randomUUID() }).success).toBe(true);
    expect(requestSupplementsSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 }).success).toBe(false);
    expect(supplementJobSchema.safeParse({ schemaVersion: 1, requestId: crypto.randomUUID(), admissionId: crypto.randomUUID(), courseId: crypto.randomUUID(), rootId: crypto.randomUUID(), ownerId: crypto.randomUUID(), sessionId: crypto.randomUUID() }).success).toBe(true);
    expect(supplementJobSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCourseMessages,
  parseCourseOutput,
  judgeRecall,
  buildRecallFeedback,
  createSyntheticCourseCompletion,
  syntheticCourseDraft,
} from '../../src/modules/course-generation/generation';
import { courseContentSchema, courseDraftSchema, submitRecallSchema, SYNTHETIC_COURSE_MODEL } from '../../src/contracts/courses';
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

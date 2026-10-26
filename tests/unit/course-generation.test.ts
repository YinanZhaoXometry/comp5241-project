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
  backgroundSummaryOf,
  classifyTrack,
  computeFactsDigest,
  factsIdenticalAcrossTracks,
} from '../../src/modules/course-generation/adaptation';
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
import {
  courseContentV1Schema,
  courseContentV3Schema,
  courseDraftV1Schema,
  courseDraftV3Schema,
  courseTrackerItems,
  markItemDoneSchema,
  storedCourseContent,
  submitRecallSchema,
  SYNTHETIC_COURSE_MODEL,
  supplementJobSchema,
  requestSupplementsSchema,
  SUPPLEMENT_QUEUE,
  type CourseContentServing,
} from '../../src/contracts/courses';
import { textCompletionRequestSchema } from '../../src/contracts/ai-provider';
import { AI_BUDGET } from '../../src/adapters/ai-live';
import type { Plan } from '../../src/contracts/setup';

// Local synthetic coverage of the epic-2 course tracer's PURE halves: bounded
// prompt building, strict plan-bounds-checked output validation (epic-2 S3
// content v2 shapes served through the epic-2 S4 content v3 union: the FULL
// plan lesson set with per-lesson sections, tracker items and one labeled
// optional enrichment, plus the per-track TREATMENT framing and the
// code-derived adaptation record), the legacy v1 union wrap, the deterministic
// local synthetic processor, the recall judge and the cross-track fact-identity
// validator. No transport, no network, no provider — everything here is
// deterministic.

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
// No stated background by default: every pre-existing case generates neutrally.
const bounds = { plan, sources, background: '' };
const input = { goal: 'Exam preparation', topic: 'unit testing', background: '', plan, excerpts };
const flatSections = (content: CourseContentServing) => content.lessons.flatMap(lesson => lesson.sections);

const validDraft = (extra: Record<string, unknown> = {}) => JSON.stringify({
  lessons: [
    { framing: 'Plain-language walkthrough of the first lesson.', sections: [{ text: 'A unit test isolates one behavior and asserts its outcome.', sourcePosition: 0, locator: 'opening lines' }] },
    { framing: 'Application focus for the second lesson.', sections: [{ text: 'A test double stands in for a real dependency during the test.', sourcePosition: 1, locator: 'opening lines' }] },
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
    expect(messages[1].content).toContain('lesson 0: What a unit test is');
    expect(messages[1].content).toContain('lesson 1: A second lesson for context');
    expect(messages[1].content).toContain('outcome 0: Explain arrange-act-assert');
    expect(messages[1].content).toContain('--- source 0: notes.txt ---');
    // The framing contract rides the system prompt: treatment prose only.
    expect(messages[0].content).toContain('framing');
    expect(messages[0].content).toContain('ONLY track-dependent part');
  });
  it('rides the stated background with its derived track and the per-track instruction', () => {
    const beginner = buildCourseMessages({ ...input, background: 'Non-CS, new to programming' });
    expect(beginner[1].content).toContain('Stated background: Non-CS, new to programming');
    expect(beginner[1].content).toContain('Derived learning track: beginner');
    expect(beginner[1].content).toContain('Track instruction: BEGINNER');
    const advanced = buildCourseMessages({ ...input, background: 'CS graduate, interview prep' });
    expect(advanced[1].content).toContain('Derived learning track: advanced');
    expect(advanced[1].content).toContain('Track instruction: ADVANCED');
    // No stated background stays honestly neutral — no invention.
    const neutral = buildCourseMessages(input);
    expect(neutral[1].content).toContain('Stated background: (none stated)');
    expect(neutral[1].content).toContain('Derived learning track: neutral');
    expect(neutral[1].content).toContain('Track instruction: NEUTRAL');
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

describe('epic-2 S4 deterministic track classification (documented keyword families)', () => {
  it('classifies every documented beginner keyword, case-insensitively', () => {
    for (const background of ['non-CS background', 'complete BEGINNER', 'new to programming', 'no programming at all', 'my first time here', 'non-technical role']) {
      expect(classifyTrack(background)).toBe('beginner');
    }
  });
  it('classifies every documented advanced keyword, case-insensitively', () => {
    for (const background of ['cs graduate', 'Computer Science Degree', 'working developer', 'software engineer', 'interview prep', 'professional background', 'experienced with code']) {
      expect(classifyTrack(background)).toBe('advanced');
    }
  });
  it('empty, whitespace and unmatched backgrounds stay neutral (no invention)', () => {
    expect(classifyTrack('')).toBe('neutral');
    expect(classifyTrack('   ')).toBe('neutral');
    expect(classifyTrack('part-time ornithologist')).toBe('neutral');
  });
  it('leftmost keyword occurrence wins on mixed backgrounds (first match wins)', () => {
    expect(classifyTrack('CS graduate helping new-to-programming colleagues')).toBe('advanced');
    expect(classifyTrack('A beginner who later became a developer')).toBe('beginner');
  });
  it('backgroundSummaryOf collapses whitespace and bounds the stored summary at the preferences limit', () => {
    expect(backgroundSummaryOf('  a \n\n  b ')).toBe('a b');
    expect(backgroundSummaryOf('x'.repeat(500))).toHaveLength(400);
  });
});

describe('strict course output validation against the confirmed plan (content v3)', () => {
  it('accepts a resolvable multi-lesson draft and substitutes every title from the plan in order', () => {
    const parsed = parseCourseOutput(validDraft(), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.contentVersion).toBe(3);
    expect(parsed.content.lessons.map(lesson => lesson.title)).toEqual(plan.miniCourse.lessons); // from the plan, never the reply
    // The treatment framing from the draft is stored per lesson, kept OUT of
    // the factual sections.
    expect(parsed.content.lessons.map(lesson => lesson.framing)).toEqual(['Plain-language walkthrough of the first lesson.', 'Application focus for the second lesson.']);
    expect(parsed.content.lessons[0].sections[0].sourceRef).toMatchObject({ extractionId: sources[0].extractionId, filename: 'notes.txt' });
    expect(parsed.content.lessons[1].sections[0].sourceRef.filename).toBe('doubles.txt');
    // Required tracker items: exactly one reading item per numbered lesson.
    expect(parsed.content.lessons[0].items).toEqual([{ id: 'lesson:1:reading', kind: 'reading', required: true, title: 'Read lesson 1: What a unit test is' }]);
    expect(parsed.content.lessons[1].items[0].id).toBe('lesson:2:reading');
    expect(parsed.content.enrichment).toBeUndefined();
    expect(parsed.content.objectives.map(objective => objective.text)).toEqual(plan.outcomes);
    expect(parsed.content.recall.sourceRef.filename).toBe('notes.txt');
    expect(courseContentV3Schema.safeParse(parsed.content).success).toBe(true);
  });
  it('derives the adaptation record from the stated background in code, never from the reply', () => {
    const beginner = parseCourseOutput(validDraft(), { ...bounds, background: 'non-CS, new to programming' });
    expect(beginner.ok).toBe(true);
    if (!beginner.ok) return;
    expect(beginner.content.adaptation).toEqual({ track: 'beginner', backgroundSummary: 'non-CS, new to programming' });
    const unmatched = parseCourseOutput(validDraft(), { ...bounds, background: 'part-time ornithologist' });
    expect(unmatched.ok && unmatched.content.adaptation).toEqual({ track: 'neutral', backgroundSummary: 'part-time ornithologist' });
    // The adaptation basis for an unstated background is neutral and empty.
    const neutral = parseCourseOutput(validDraft(), bounds);
    expect(neutral.ok).toBe(true);
    if (neutral.ok) expect(neutral.content.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
  });
  it('resolves the optional enrichment link and labels it optional and untracked', () => {
    const parsed = parseCourseOutput(validDraft({ enrichment: { sourcePosition: 1, locator: 'second paragraph', text: 'Doubles keep tests fast and deterministic.' } }), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.enrichment).toMatchObject({
      id: 'enrichment:1',
      kind: 'enrichment',
      required: false,
      text: 'Doubles keep tests fast and deterministic.',
      sourceRef: { filename: 'doubles.txt', locator: 'second paragraph' },
    });
    const items = courseTrackerItems(parsed.content);
    expect(items.filter(item => !item.required)).toHaveLength(1);
    expect(items.find(item => !item.required)?.id).toBe('enrichment:1');
  });
  it('accepts a single fenced json block and recovers balanced objects from trailing noise', () => {
    expect(parseCourseOutput(`\`\`\`json\n${validDraft()}\n\`\`\``, bounds).ok).toBe(true);
    expect(parseCourseOutput(`${validDraft()}}}`, bounds).ok).toBe(true);
    expect(parseCourseOutput(`${validDraft()}\nNote: good luck!`, bounds).ok).toBe(true);
  });
  it('rejects prose, malformed JSON, extra keys, wrong lesson counts, legacy drafts and unresolved links', () => {
    expect(parseCourseOutput('Here is your lesson: ...', bounds).ok).toBe(false);
    expect(parseCourseOutput('{not json', bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ extra: 1 }), bounds).ok).toBe(false);
    // Fewer/more lessons than the confirmed plan declares.
    expect(parseCourseOutput(validDraft({ lessons: [{ framing: 'f', sections: [{ text: 'x', sourcePosition: 0, locator: 'l' }] }] }), bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ lessons: [...JSON.parse(validDraft()).lessons, { framing: 'f', sections: [{ text: 'x', sourcePosition: 0, locator: 'l' }] }] }), bounds).ok).toBe(false);
    // The legacy single-lesson draft shape no longer validates.
    expect(parseCourseOutput(JSON.stringify({ sections: [{ text: 'x', sourcePosition: 0, locator: 'l' }], objectiveIndexes: [0], recall: { objectiveIndex: 0, sourcePosition: 0, locator: 'l', prompt: 'p', answer: 'a', rationale: 'r' } }), bounds).ok).toBe(false);
    // The pre-2.4 multi-lesson draft shape (no per-lesson framing) no longer
    // validates, and framing missing on ONE lesson is still an invalid draft.
    const noFraming = JSON.parse(validDraft());
    for (const lesson of noFraming.lessons) delete lesson.framing;
    expect(parseCourseOutput(JSON.stringify(noFraming), bounds).ok).toBe(false);
    const oneMissing = JSON.parse(validDraft());
    delete oneMissing.lessons[1].framing;
    expect(parseCourseOutput(JSON.stringify(oneMissing), bounds).ok).toBe(false);
    // A processor-supplied track/adaptation is an extra key: rejected — the
    // record is derived in code from the stated background only.
    expect(parseCourseOutput(validDraft({ track: 'advanced' }), bounds).ok).toBe(false);
    // Objective index beyond the plan's outcomes; duplicates.
    expect(parseCourseOutput(validDraft({ objectiveIndexes: [0, 1, 3] }), bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ objectiveIndexes: [0, 0, 1] }), bounds).ok).toBe(false);
    // Source position beyond the selected sources (lesson section and recall).
    expect(parseCourseOutput(validDraft({ lessons: [{ framing: 'f', sections: [{ text: 'x', sourcePosition: 5, locator: 'l' }] }, { framing: 'f', sections: [{ text: 'y', sourcePosition: 1, locator: 'l' }] }] }), bounds).ok).toBe(false);
    expect(parseCourseOutput(validDraft({ recall: { objectiveIndex: 0, sourcePosition: 2, locator: 'l', prompt: 'p', answer: 'a', rationale: 'r' } }), bounds).ok).toBe(false);
    // Enrichment with an unresolved source link.
    expect(parseCourseOutput(validDraft({ enrichment: { sourcePosition: 7, locator: 'l', text: 't' } }), bounds).ok).toBe(false);
    expect(parseCourseOutput('', bounds).ok).toBe(false);
    // The draft schema itself bounds the shapes the parser trusts.
    expect(courseDraftV3Schema.safeParse({ lessons: [], objectiveIndexes: [0], recall: {} }).success).toBe(false);
    expect(courseDraftV1Schema.safeParse({ sections: [], objectiveIndexes: [0], recall: {} }).success).toBe(false);
  });
  it('rejects stored lesson items that do not match their numbered position (tracker identity is positional)', () => {
    const parsed = parseCourseOutput(validDraft(), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const tampered = structuredClone(parsed.content);
    tampered.lessons[1].items[0].id = 'lesson:1:reading';
    expect(courseContentV3Schema.safeParse(tampered).success).toBe(false);
  });
});

describe('legacy v1 stored content serves through the v2 wrap (one serving path)', () => {
  const legacy = {
    lessonTitle: 'What a unit test is',
    sections: [{ text: 'A unit test isolates one behavior.', sourceRef: { extractionId: sources[0].extractionId, filename: 'notes.txt', locator: 'opening lines' } }],
    objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
    recall: { objectiveIndex: 0, sourceRef: { extractionId: sources[0].extractionId, filename: 'notes.txt', locator: 'opening lines' }, prompt: 'p', answer: 'a', rationale: 'r' },
  };
  it('keeps accepting the exact pre-2.3 stored shape unchanged', () => {
    expect(courseContentV1Schema.safeParse(legacy).success).toBe(true);
  });
  it('wraps a v1 row as its own single-lesson degenerate case with a derived reading item and no enrichment', () => {
    const wrapped = storedCourseContent(legacy);
    expect(wrapped).not.toBeNull();
    if (!wrapped) return;
    expect(wrapped.contentVersion).toBe(2);
    expect(wrapped.lessons).toHaveLength(1);
    expect(wrapped.lessons[0].title).toBe('What a unit test is');
    expect(wrapped.lessons[0].sections).toHaveLength(1);
    expect(wrapped.lessons[0].items).toEqual([{ id: 'lesson:1:reading', kind: 'reading', required: true, title: 'Read lesson 1: What a unit test is' }]);
    expect(wrapped.enrichment).toBeUndefined();
    expect(wrapped.recall.answer).toBe('a'); // the stored v1 row itself still carries it server-side
  });
  it('passes v2 content through unchanged and rejects documents matching neither version', () => {
    const parsed = parseCourseOutput(validDraft(), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(storedCourseContent(parsed.content)).toEqual(parsed.content);
    expect(storedCourseContent({ nope: true })).toBeNull();
    expect(storedCourseContent(null)).toBeNull();
  });
  it('courseTrackerItems lists required readings in sequence order, then the optional enrichment last', () => {
    const parsed = parseCourseOutput(validDraft({ enrichment: { sourcePosition: 1, locator: 'l', text: 't' } }), bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const items = courseTrackerItems(parsed.content);
    expect(items.map(item => item.id)).toEqual(['lesson:1:reading', 'lesson:2:reading', 'enrichment:1']);
    expect(items.map(item => item.required)).toEqual([true, true, false]);
    expect(items.map(item => item.lessonNumber)).toEqual([1, 2, null]);
    expect(items[2]).toMatchObject({ text: 't', source: { filename: 'doubles.txt', locator: 'l' } });
  });
});

describe('deterministic local synthetic processor (content v3)', () => {
  it('returns a strict-parseable, zero-token, deterministic draft covering every plan lesson in order', async () => {
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
    expect(parsed.content.contentVersion).toBe(3);
    expect(parsed.content.lessons.map(lesson => lesson.title)).toEqual(plan.miniCourse.lessons);
    for (const lesson of parsed.content.lessons) expect(lesson.sections.length).toBeGreaterThanOrEqual(1);
    // The unstated background generates neutrally with honest neutral framing.
    expect(parsed.content.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
    expect(parsed.content.lessons.every(lesson => lesson.framing.length > 0)).toBe(true);
    // Fair distribution: source 0 teaches lesson 1, source 1 teaches lesson 2.
    expect(parsed.content.lessons[0].sections[0].sourceRef.filename).toBe('notes.txt');
    expect(parsed.content.lessons[1].sections[0].sourceRef.filename).toBe('doubles.txt');
    expect(parsed.content.objectives.length).toBe(plan.outcomes.length);
    expect(parsed.content.recall.answer.length).toBeGreaterThanOrEqual(1);
    // One labeled optional enrichment overall, from the last usable source.
    expect(parsed.content.enrichment?.sourceRef.filename).toBe('doubles.txt');
    expect(parsed.content.enrichment?.required).toBe(false);
  });
  it('rejects non-message input honestly without dispatching', async () => {
    const outcome = await createSyntheticCourseCompletion().complete({ messages: 'nope' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('invalid-input');
    expect(outcome.error.outcome).toBe('not-dispatched');
  });
  it('syntheticCourseDraft is stable for identical input and bounded in section length', () => {
    const oneLessonPlan = { ...plan, miniCourse: { ...plan.miniCourse, lessons: ['What a unit test is'] } };
    const messages = buildCourseMessages({ ...input, plan: oneLessonPlan, excerpts: [{ name: 'big.txt', text: 'z'.repeat(64 * 1024) }] });
    const a = syntheticCourseDraft(messages);
    const b = syntheticCourseDraft(messages);
    expect(a).toBe(b);
    const parsed = parseCourseOutput(a, { plan: oneLessonPlan, sources: [sources[0]], background: '' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const lesson of parsed.content.lessons) for (const section of lesson.sections) expect(section.text.length).toBeLessThanOrEqual(480);
  });
  it('round-trips a legal 10-source selection across two lessons: links resolve, no text quotes the recall answer', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ name: `t${index}.txt`, text: `Source ${index} opens here. Source ${index} remainder continues the lesson body.` }));
    const tenSources = ten.map(excerpt => ({ extractionId: crypto.randomUUID(), filename: excerpt.name }));
    const messages = buildCourseMessages({ ...input, excerpts: ten });
    const draft = syntheticCourseDraft(messages);
    const parsed = parseCourseOutput(draft, { plan, sources: tenSources, background: '' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Fair round-robin: even positions to lesson 1, odd to lesson 2 — every
    // source used exactly once, no lesson over the 8-section cap.
    expect(parsed.content.lessons).toHaveLength(2);
    expect(parsed.content.lessons[0].sections).toHaveLength(5);
    expect(parsed.content.lessons[1].sections).toHaveLength(5);
    const used = flatSections(parsed.content).map(section => section.sourceRef.extractionId);
    expect(new Set(used).size).toBe(10);
    // Withholding at the source: the recall's canonical answer (source 0's
    // opening sentence) appears in no served section OR enrichment text.
    for (const section of flatSections(parsed.content)) expect(section.text).not.toContain(parsed.content.recall.answer);
    expect(parsed.content.enrichment?.text ?? '').not.toContain(parsed.content.recall.answer);
    expect(parsed.content.lessons[0].sections[0].text).toContain('remainder continues the lesson body');
    // The enrichment is the last usable source's teaching text.
    expect(parsed.content.enrichment?.sourceRef.filename).toBe('t9.txt');
  });
  it('keeps every plan lesson present when there are fewer sources than lessons (honest fallback)', () => {
    const single = [{ name: 'only.txt', text: 'Only source opens here. Its remainder teaches the whole course honestly.' }];
    const messages = buildCourseMessages({ ...input, excerpts: single });
    const parsed = parseCourseOutput(syntheticCourseDraft(messages), { plan, sources: [sources[0]], background: '' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.lessons).toHaveLength(2);
    expect(parsed.content.lessons[1].sections[0].sourceRef.locator).toContain('no dedicated source reached this lesson');
  });
  it('caps a single-lesson course at 8 sections when a 10-source selection round-robins into one lesson', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ name: `t${index}.txt`, text: `Source ${index} opens here. Source ${index} remainder continues the body.` }));
    const tenSources = ten.map(excerpt => ({ extractionId: crypto.randomUUID(), filename: excerpt.name }));
    const oneLessonPlan = { ...plan, miniCourse: { ...plan.miniCourse, lessons: ['What a unit test is'] } };
    const messages = buildCourseMessages({ ...input, plan: oneLessonPlan, excerpts: ten });
    const parsed = parseCourseOutput(syntheticCourseDraft(messages), { plan: oneLessonPlan, sources: tenSources, background: '' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.lessons[0].sections).toHaveLength(8);
  });
  it('ignores lesson- and outcome-looking lines inside source excerpts (counting is header-bounded)', () => {
    // Notes containing lines like "lesson 1: intro" at a line start must not
    // inflate the lesson/outcome counts and fail generation with a false
    // invalid-output — only the structured header counts.
    const sneaky = [
      { name: 'notes.txt', text: 'Real body line.\nlesson 1: intro appears in the notes.\nlesson 9: another stray heading.\noutcome 2: fake line also appears.' },
      { name: 'doubles.txt', text: 'A test double stands in for a dependency.\nlesson 0: stray heading in the second source.' },
    ];
    const messages = buildCourseMessages({ ...input, excerpts: sneaky });
    const draft = syntheticCourseDraft(messages);
    const parsed = parseCourseOutput(draft, bounds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.content.lessons).toHaveLength(plan.miniCourse.lessons.length);
    expect(parsed.content.objectives.map(objective => objective.index)).toEqual([0, 1, 2]);
  });
});

describe('epic-2 S4 side-by-side: per-track treatment over identical facts', () => {
  const courseUnder = (background: string) =>
    parseCourseOutput(syntheticCourseDraft(buildCourseMessages({ ...input, background })), { ...bounds, background });
  it('the fixture draft itself carries no track — the stored record is code-derived', () => {
    const draft = JSON.parse(syntheticCourseDraft(buildCourseMessages({ ...input, background: 'non-CS, new to programming' })));
    expect(draft).not.toHaveProperty('track');
    expect(draft).not.toHaveProperty('adaptation');
  });
  it('beginner and advanced treatments differ while every factual section, source ref, objective, recall answer and enrichment is identical', () => {
    const beginner = courseUnder('non-CS, new to programming');
    const advanced = courseUnder('CS graduate, interview prep');
    expect(beginner.ok && advanced.ok).toBe(true);
    if (!beginner.ok || !advanced.ok) return;
    expect(beginner.content.adaptation).toEqual({ track: 'beginner', backgroundSummary: 'non-CS, new to programming' });
    expect(advanced.content.adaptation).toEqual({ track: 'advanced', backgroundSummary: 'CS graduate, interview prep' });
    // Treatment differs AND DELIVERS the promised pitch, not a description of
    // it: the beginner framing carries a concrete everyday example anchored on
    // the lesson's own outcome text plus an explicit prerequisite line; the
    // advanced framing carries an actual application-scenario sentence and a
    // concrete trade-off question.
    expect(beginner.content.lessons[0].framing).not.toBe(advanced.content.lessons[0].framing);
    expect(beginner.content.lessons[0].framing).toContain('Everyday example:');
    expect(beginner.content.lessons[0].framing).toContain('working toward “Explain arrange-act-assert” is like following a recipe');
    expect(beginner.content.lessons[0].framing).toContain('Before this lesson you need:');
    expect(beginner.content.lessons[0].framing).toContain('no prior programming assumed');
    expect(advanced.content.lessons[0].framing).toContain('Scenario:');
    expect(advanced.content.lessons[0].framing).toContain('“Explain arrange-act-assert” is on your critical path');
    expect(advanced.content.lessons[0].framing).toContain('Trade-off to weigh:');
    expect(advanced.content.lessons[0].framing).toContain('what does reaching for it anyway cost you');
    // The factual core is byte-identical across tracks — provable, not eyeballed.
    expect(factsIdenticalAcrossTracks(beginner.content, advanced.content)).toEqual({ identical: true, differences: [] });
    // The stored factual-core digest makes that identity cheap for any
    // consumer: shared across tracks, sha-256 hex, and it moves when facts do.
    expect(beginner.content.factsDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(beginner.content.factsDigest).toBe(advanced.content.factsDigest);
    const driftedFacts = structuredClone(advanced.content);
    driftedFacts.lessons[0].sections[0].text += ' A drifted fact.';
    expect(computeFactsDigest(driftedFacts)).not.toBe(advanced.content.factsDigest);
    // Treatment-only change keeps the digest: recompute over the drifted
    // content's unchanged factual core reproduces the stored digest.
    expect(beginner.content.factsDigest).toBe(computeFactsDigest(beginner.content));
    expect(beginner.content.lessons.map(lesson => lesson.sections)).toEqual(advanced.content.lessons.map(lesson => lesson.sections));
    expect(beginner.content.lessons.map(lesson => lesson.title)).toEqual(advanced.content.lessons.map(lesson => lesson.title));
    expect(beginner.content.recall).toEqual(advanced.content.recall);
    expect(beginner.content.enrichment).toEqual(advanced.content.enrichment);
    expect(beginner.content.objectives).toEqual(advanced.content.objectives);
  });
  it('neutral and unmatched backgrounds claim no track and keep the same factual core', () => {
    const empty = courseUnder('');
    const unmatched = courseUnder('part-time ornithologist');
    expect(empty.ok && unmatched.ok).toBe(true);
    if (!empty.ok || !unmatched.ok) return;
    expect(empty.content.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
    expect(unmatched.content.adaptation).toEqual({ track: 'neutral', backgroundSummary: 'part-time ornithologist' });
    expect(factsIdenticalAcrossTracks(empty.content, unmatched.content).identical).toBe(true);
    expect(empty.content.lessons.every(lesson => /no track-specific framing/i.test(lesson.framing))).toBe(true);
  });
  it('factsIdenticalAcrossTracks flags factual drift precisely and ignores treatment-only differences', () => {
    const beginner = courseUnder('non-CS, new to programming');
    const advanced = courseUnder('CS graduate, interview prep');
    if (!beginner.ok || !advanced.ok) return;
    // Factual drift in one section's text is named exactly.
    const drifted = structuredClone(advanced.content);
    drifted.lessons[1].sections[0].text += ' An extra claim appeared.';
    const drift = factsIdenticalAcrossTracks(beginner.content, drifted);
    expect(drift.identical).toBe(false);
    expect(drift.differences).toContain('lessons[1].sections[0].text');
    // A dropped source link is factual drift too.
    const relinked = structuredClone(advanced.content);
    relinked.lessons[0].sections[0].sourceRef.locator = 'somewhere else entirely';
    expect(factsIdenticalAcrossTracks(beginner.content, relinked).identical).toBe(false);
    // Treatment-only differences (framing, adaptation record) are NOT factual drift.
    const reframed = structuredClone(advanced.content);
    reframed.lessons[0].framing = 'A completely different framing paragraph.';
    reframed.adaptation = { track: 'neutral', backgroundSummary: '' };
    expect(factsIdenticalAcrossTracks(beginner.content, reframed)).toEqual({ identical: true, differences: [] });
    // Cross-study comparison may ignore per-study extraction ids.
    const foreign = structuredClone(advanced.content);
    foreign.lessons[0].sections[0].sourceRef.extractionId = crypto.randomUUID();
    expect(factsIdenticalAcrossTracks(beginner.content, foreign).identical).toBe(false);
    expect(factsIdenticalAcrossTracks(beginner.content, foreign, { ignoreSourceIds: true }).identical).toBe(true);
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
  it('the recall and tracker command envelopes stay strict', () => {
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attempted: 'an answer' }).success).toBe(true);
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 }).success).toBe(false);
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attempted: '' }).success).toBe(false);
    expect(submitRecallSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attempted: 'x', extra: true }).success).toBe(false);
    expect(markItemDoneSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), itemId: 'lesson:1:reading' }).success).toBe(true);
    expect(markItemDoneSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID() }).success).toBe(false);
    expect(markItemDoneSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, itemId: 'lesson:1:reading' }).success).toBe(false);
    expect(markItemDoneSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 2, courseId: crypto.randomUUID(), itemId: 'lesson:1:reading', extra: 1 }).success).toBe(false);
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
  const proposalBounds = { gaps, outcomes: plan.outcomes, sections: flatSections(parsed.content), allowlist: fixtureAllowlist };
  it('builds an adapter-valid prompt that lists allowlist, gaps, outcomes and upload sections', () => {
    const messages = buildProposalMessages({ lessonTitle: parsed.content.lessons[0].title, gaps, outcomes: plan.outcomes, sections: flatSections(parsed.content), allowlist: fixtureAllowlist });
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
        sectionIndex: index % flatSections(parsed.content).length,
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
  const proposalBounds = { gaps, outcomes: plan.outcomes, sections: flatSections(parsed.content), allowlist: fixtureAllowlist };
  const messages = buildProposalMessages({ lessonTitle: parsed.content.lessons[0].title, gaps, outcomes: plan.outcomes, sections: flatSections(parsed.content), allowlist: fixtureAllowlist });
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

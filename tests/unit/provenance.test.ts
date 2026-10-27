import { describe, expect, it } from 'vitest';
import {
  parseProvenanceFields,
  provenanceDocumentSchema,
  provenanceFieldNames,
  type ProvenanceDocument,
} from '../../src/contracts/provenance';

// Epic-2 S7 unit coverage of the provenance document CONTRACT: the schema is
// the authority and is attempt-independent by construction — answers,
// rationales and attempt content are structurally absent (every object is
// strict, so a payload carrying them anywhere fails validation), the `fields=`
// scope-declaration set has no name for them either, and the document is
// split into the immutable-per-version block and the monotonic derivatives
// block.

const sourceRef = { extractionId: crypto.randomUUID(), filename: 'notes.txt', locator: 'opening lines' };

const validDocument: ProvenanceDocument = {
  immutable: {
    course: {
      id: crypto.randomUUID(),
      version: 1,
      lineage: {
        planRevisionId: crypto.randomUUID(),
        selectionId: crypto.randomUUID(),
        extractionIds: [sourceRef.extractionId],
        objectId: crypto.randomUUID(),
        admissionId: crypto.randomUUID(),
      },
      model: 'local-synthetic-course-fixture-v1',
      factsDigest: 'a'.repeat(64),
      adaptation: { track: 'neutral', backgroundSummary: '' },
      createdAt: '2026-10-27T10:00:00.000Z',
      settledAt: '2026-10-27T10:00:01.000Z',
    },
    objectives: [{ position: 0, text: 'Explain arrange-act-assert', version: 1 }],
    units: [{ lesson: 1, title: 'What a unit test is', position: 0, text: 'A unit test isolates one behavior.', sourceRef }],
    practiceItems: [{ id: 'practice:0', objectiveIndex: 0, sourceRef }],
    trackerItems: [{ id: 'lesson:1:reading', required: true, title: 'Read lesson 1: What a unit test is' }],
  },
  derivatives: {
    supplements: [],
    whyExplanations: [],
  },
};

describe('epic-2 S7 provenance document schema', () => {
  it('accepts the full contract document', () => {
    expect(provenanceDocumentSchema.safeParse(validDocument).success).toBe(true);
  });
  it('splits the document into the immutable block and the monotonic derivatives block — neither carries the other\'s fields', () => {
    // Derivative fields cannot enter the immutable block...
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...validDocument.immutable, supplements: [] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...validDocument.immutable, whyExplanations: [] } }).success).toBe(false);
    // ...and immutable-block fields cannot enter the derivatives block.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, derivatives: { ...validDocument.derivatives, units: [] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, derivatives: { ...validDocument.derivatives, trackerItems: [] } }).success).toBe(false);
    // A flat (pre-split) document shape is invalid too.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument.immutable, ...validDocument.derivatives }).success).toBe(false);
  });
  it('structurally cannot carry answers, rationales or attempt content anywhere — strict objects reject them', () => {
    const immutable = validDocument.immutable;
    // Top level.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, attempts: [] }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, answers: [] }).success).toBe(false);
    // Course block.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, course: { ...immutable.course, answer: 'x' } } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, course: { ...immutable.course, rationale: 'x' } } }).success).toBe(false);
    // Lineage.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, course: { ...immutable.course, lineage: { ...immutable.course.lineage, attempted: 'x' } } } }).success).toBe(false);
    // Practice items: prompt, answer and rationale have no field there either —
    // the reveal path is per-card submission feedback and nothing else.
    for (const extra of [{ prompt: 'p' }, { answer: 'a' }, { rationale: 'r' }, { attempted: 'x' }, { outcome: 'correct' }, { evidenceKind: 'unaided' }]) {
      expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, practiceItems: [{ ...immutable.practiceItems[0], ...extra }] } }).success).toBe(false);
    }
    // Units and tracker items.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, units: [{ ...immutable.units[0], answer: 'a' }] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, trackerItems: [{ ...immutable.trackerItems[0], done: true, doneAt: '2026-10-27T10:00:00.000Z' }] } }).success).toBe(false);
    // Objectives and supplements.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, objectives: [{ ...immutable.objectives[0], answer: 'a' }] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, derivatives: { ...validDocument.derivatives, supplements: [{ position: 0, outcome: 'supported', url: 'https://docs.example.org/x', origin: 'docs.example.org', locator: 'l', hash: 'b'.repeat(64), retrievedAt: '2026-10-27T10:00:00.000Z', attempted: 'x' }] } }).success).toBe(false);
    // Why explanations carry sources only — never attempt-adjacent fields.
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, derivatives: { ...validDocument.derivatives, whyExplanations: [{ lesson: 1, depth: 1, dimension: 'purpose', sources: [{ kind: 'lesson', filename: 'notes.txt', locator: 'l' }], answer: 'a' }] } }).success).toBe(false);
  });
  it('bounds the shapes honestly: bad ids, digests, dimensions and dates fail', () => {
    const immutable = validDocument.immutable;
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, practiceItems: [{ ...immutable.practiceItems[0], id: 'not-a-card' }] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, course: { ...immutable.course, factsDigest: 'nothex' } } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, course: { ...immutable.course, createdAt: 'yesterday' } } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, objectives: [] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, units: [] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, practiceItems: [] } }).success).toBe(false);
    expect(provenanceDocumentSchema.safeParse({ ...validDocument, immutable: { ...immutable, course: { ...immutable.course, lineage: { ...immutable.course.lineage, extractionIds: [] } } } }).success).toBe(false);
  });
});

describe('epic-2 S7 fields= scope declaration', () => {
  it('names only contract fields — no answer, rationale or attempt name exists to request', () => {
    for (const banned of ['answers', 'answer', 'rationales', 'rationale', 'attempts', 'attempted', 'attempt', 'evidence', 'evidenceKind', 'done', 'prompt']) expect(provenanceFieldNames).not.toContain(banned);
    // Every contract field name is declarable, alone and together.
    for (const name of provenanceFieldNames) expect(parseProvenanceFields(name)).toEqual({ ok: true, fields: [name] });
    expect(parseProvenanceFields(provenanceFieldNames.join(','))).toEqual({ ok: true, fields: [...provenanceFieldNames] });
    // Whitespace around names is tolerated; duplicates declare nothing new.
    expect(parseProvenanceFields(' course , units ').ok).toBe(true);
    expect(parseProvenanceFields('course,course').ok).toBe(true);
  });
  it('rejects any non-contract name — the surface structurally cannot serve it', () => {
    for (const raw of ['answers', 'attempts', 'rationale', 'attempted', 'answer,units', 'units,answers', 'bogus', '', ' ', 'course,,units', 'Answers']) expect(parseProvenanceFields(raw).ok).toBe(false);
  });
  it('rejects the joined form of a repeated ?fields= parameter — every value reaches validation', () => {
    // The route joins ALL values of a repeated ?fields= parameter into one
    // declaration, so a non-contract name cannot hide behind a first valid
    // value — in either order.
    expect(parseProvenanceFields(['course', 'answers'].join(',')).ok).toBe(false);
    expect(parseProvenanceFields(['answers', 'course'].join(',')).ok).toBe(false);
    expect(parseProvenanceFields(['units', 'attempts', 'course'].join(',')).ok).toBe(false);
    expect(parseProvenanceFields(['course', 'units'].join(',')).ok).toBe(true);
  });
});

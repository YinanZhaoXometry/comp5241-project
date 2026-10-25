import { describe, expect, it, vi } from 'vitest';
import { buildDraftMessages, parseDraftOutput } from '../../src/modules/ai-setup/generation';
import { textCompletionRequestSchema } from '../../src/contracts/ai-provider';
import { AI_BUDGET, createDestinationTransport } from '../../src/adapters/ai-live';

// Local synthetic coverage of the S6 draft pipeline's PURE halves: bounded
// prompt building and strict output validation. No transport, no network, no
// provider — everything here is deterministic.

const validPlan = {
  topic: 'Unit testing fundamentals',
  goal: 'Understand a topic',
  clarification: '',
  outcomes: ['Explain arrange-act-assert'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const validDraft = JSON.stringify({ topics: ['Unit testing', 'Assertions', 'Test doubles'], plan: validPlan });

describe('bounded draft prompt building', () => {
  it('builds a system+user pair that passes the adapter request contract under the token ceiling', () => {
    const messages = buildDraftMessages({ goal: 'Exam preparation', topic: 'JUnit', excerpts: [{ name: 'notes.txt', text: 'A'.repeat(4096) }] });
    const parsed = textCompletionRequestSchema.safeParse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
    expect(parsed.success).toBe(true);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('--- source: notes.txt ---');
  });

  it('truncates over-long excerpts fairly, keeps every source present and states the cut', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ name: `s${index}.txt`, text: 'x'.repeat(64 * 1024) }));
    const messages = buildDraftMessages({ goal: '', topic: '', excerpts: many });
    const aggregate = messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.content, 'utf8'), 0);
    expect(aggregate).toBeLessThanOrEqual(32 * 1024);
    for (let index = 0; index < many.length; index += 1) expect(messages[1].content).toContain(`--- source: s${index}.txt ---`);
    expect(messages[1].content).toContain('were longer than the bounded prompt');
  });

  it('always yields at least the minimum excerpt bytes even with many sources', () => {
    const messages = buildDraftMessages({ goal: 'Other', topic: 't', excerpts: [{ name: 'a.txt', text: 'y'.repeat(4096) }] });
    expect(messages[1].content).toContain('y'.repeat(64));
  });
});

describe('strict draft output validation', () => {
  it('accepts a bare strict-JSON reply and a single fenced json block', () => {
    expect(parseDraftOutput(validDraft).ok).toBe(true);
    expect(parseDraftOutput(`\`\`\`json\n${validDraft}\n\`\`\``).ok).toBe(true);
  });
  it('rejects prose, malformed JSON, extra keys, wrong bounds and truncation-shaped output', () => {
    expect(parseDraftOutput('Here is your plan: ...').ok).toBe(false);
    expect(parseDraftOutput('{not json').ok).toBe(false);
    expect(parseDraftOutput(JSON.stringify({ topics: ['a', 'b'], plan: validPlan })).ok).toBe(false); // too few topics
    expect(parseDraftOutput(JSON.stringify({ topics: ['a', 'b', 'c'], plan: { ...validPlan, outcomes: [] } })).ok).toBe(false);
    expect(parseDraftOutput(JSON.stringify({ topics: ['a', 'b', 'c'], plan: validPlan, extra: 1 })).ok).toBe(false);
    expect(parseDraftOutput('').ok).toBe(false);
  });
  it('recovers the first balanced object when the model appends surplus braces or trailing noise', () => {
    expect(parseDraftOutput(`${validDraft}}}`).ok).toBe(true); // observed Kimi k3 behavior
    expect(parseDraftOutput(`${validDraft}\nNote: good luck!`).ok).toBe(true);
    expect(parseDraftOutput(`{"broken": ${validDraft}`).ok).toBe(false); // unbalanced is still rejected
    // A string containing braces must not confuse the brace scanner.
    const withBraces = JSON.stringify({ topics: ['a {b} c', 'd', 'e'], plan: validPlan });
    expect(parseDraftOutput(withBraces).ok).toBe(true);
  });
  it('returns the validated shape, never raw text, on success', () => {
    const parsed = parseDraftOutput(validDraft);
    expect(parsed.ok && parsed.result.plan.topic).toBe('Unit testing fundamentals');
    expect(parsed.ok && parsed.result.topics).toHaveLength(3);
  });
});

describe('destination-enforcing transport', () => {
  it('refuses every URL except the exact chat-completions endpoint before any I/O', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch must not run for refused destinations'); }));
    try {
      const transport = createDestinationTransport('https://api.example.test/v1');
      await expect(transport('https://evil.test/v1/chat/completions')).rejects.toThrow('Destination not allowed');
      await expect(transport('https://api.example.test/v1/embeddings')).rejects.toThrow('Destination not allowed');
      await expect(transport('https://api.example.test/v1/chat/completions/extra')).rejects.toThrow('Destination not allowed');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('delegates only the exact endpoint to fetch and derives it like the adapter (no /v1 added)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch reached'); }));
    try {
      const transport = createDestinationTransport('https://api.example.test/coding/v1/');
      await expect(transport('https://api.example.test/coding/v1/chat/completions')).rejects.toThrow('fetch reached');
      await expect(transport('https://api.example.test/coding/v1/v1/chat/completions')).rejects.toThrow('Destination not allowed');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLiveCompletion } from '../src/adapters/ai-live';
import { textCompletionRequestSchema } from '../src/contracts/ai-provider';

// MANUAL live smoke for the S6 owner-admitted endpoint. NOT part of
// `npm run checks`: it makes ONE real completion call using the
// git-ignored .local/ai-provider.json, prints a content-free summary and
// records the evidence file under .local/. The key is never printed or stored.
// Run: npm run ai:smoke

const port = await createLiveCompletion();
if (!port) {
  console.error(JSON.stringify({ event: 'ai-smoke-no-provider', message: '.local/ai-provider.json is absent or invalid; nothing was dispatched.' }));
  process.exit(1);
}

// Probe 1 — connectivity: one trivial completion. k3 reasons before answering,
// so the ceiling must leave room for the thinking tokens or the content comes
// back truncated (the adapter rejects that honestly).
const messages = textCompletionRequestSchema.parse({
  messages: [
    { role: 'system', content: 'You reply with STRICT JSON only. The object has exactly one key "ok" with the boolean true.' },
    { role: 'user', content: 'Reply now.' },
  ],
  maxOutputTokens: 256,
});
const started = Date.now();
const result = await port.complete(messages);
const elapsedMs = Date.now() - started;
if (!result.ok) {
  await writeFile(resolve('.local/ai-smoke-latest.json'), JSON.stringify({ event: 'ai-smoke', ok: false, code: result.error.code, outcome: result.error.outcome, elapsedMs, at: new Date().toISOString() }, null, 2), 'utf8');
  console.log(JSON.stringify({ event: 'ai-smoke', ok: false, code: result.error.code, outcome: result.error.outcome, elapsedMs }));
  process.exit(2);
}
console.log(JSON.stringify({ event: 'ai-smoke', ok: true, model: result.provenance.returnedModel, usage: result.usage, replyChars: result.text.length, elapsedMs }));

// Probe 2 — the REAL S6 demonstration: one actual topic/plan draft through the
// production prompt builder and strict output parser over a synthetic source.
const { buildDraftMessages, parseDraftOutput } = await import('../src/modules/ai-setup/generation');
const draftMessages = buildDraftMessages({
  goal: 'Exam preparation',
  topic: 'unit testing',
  excerpts: [{ name: 'synthetic-notes.txt', text: 'Unit testing checks a single unit of behavior. Arrange inputs, act on the unit, assert the expected outcome. A test double stands in for a dependency. Coverage tools report which lines executed, not whether assertions were meaningful.' }],
});
const draftStarted = Date.now();
const draftResult = await port.complete(textCompletionRequestSchema.parse({ messages: draftMessages, maxOutputTokens: 1200 }));
const draftParsed = draftResult.ok ? parseDraftOutput(draftResult.text) : null;
const evidence = {
  event: 'ai-smoke',
  ok: true,
  probe1: { model: result.provenance.returnedModel, usage: result.usage, elapsedMs },
  probe2: {
    ok: draftResult.ok,
    parsed: draftParsed?.ok === true,
    usage: draftResult.ok ? draftResult.usage : null,
    failure: draftResult.ok ? null : draftResult.error.code,
    elapsedMs: Date.now() - draftStarted,
    draft: draftParsed?.ok ? draftParsed.result : draftResult.ok ? { rejectedTextChars: draftResult.text.length } : null,
  },
  at: new Date().toISOString(),
};
await writeFile(resolve('.local/ai-smoke-latest.json'), JSON.stringify(evidence, null, 2), 'utf8');
console.log(JSON.stringify({ event: 'ai-smoke-draft', ok: evidence.probe2.parsed, usage: evidence.probe2.usage, topics: evidence.probe2.draft && 'topics' in evidence.probe2.draft ? evidence.probe2.draft.topics.length : null, elapsedMs: evidence.probe2.elapsedMs }));

// Probe 3 — the REAL S7 take-path demonstration: generate a 3–5-item starting
// check through the production prompt builder and strict item validator.
const { buildCheckMessages, parseCheckOutput } = await import('../src/modules/ai-setup/generation');
const outcomes = ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'];
const checkStarted = Date.now();
const checkResult = await port.complete(textCompletionRequestSchema.parse({
  messages: buildCheckMessages({
    goal: 'Exam preparation',
    topic: 'unit testing',
    outcomes,
    excerpts: [
      { name: 'synthetic-notes.txt', text: 'Unit testing checks a single unit of behavior. Arrange inputs, act on the unit, assert the expected outcome.' },
      { name: 'synthetic-doubles.txt', text: 'A test double stands in for a dependency. Coverage tools report which lines executed, not whether assertions were meaningful.' },
    ],
  }),
  maxOutputTokens: 1200,
}));
const checkParsed = checkResult.ok ? parseCheckOutput(checkResult.text, { outcomesCount: outcomes.length, sourcesCount: 2 }) : null;
const finalEvidence = {
  ...evidence,
  probe3: {
    ok: checkResult.ok,
    parsed: checkParsed?.ok === true,
    items: checkParsed?.ok ? checkParsed.items.length : null,
    usage: checkResult.ok ? checkResult.usage : null,
    failure: checkResult.ok ? null : checkResult.error.code,
    elapsedMs: Date.now() - checkStarted,
  },
};
await writeFile(resolve('.local/ai-smoke-latest.json'), JSON.stringify(finalEvidence, null, 2), 'utf8');
console.log(JSON.stringify({ event: 'ai-smoke-check', ok: finalEvidence.probe3.parsed, items: finalEvidence.probe3.items, usage: finalEvidence.probe3.usage, elapsedMs: finalEvidence.probe3.elapsedMs }));
process.exit(finalEvidence.probe2.parsed && finalEvidence.probe3.parsed ? 0 : 3);

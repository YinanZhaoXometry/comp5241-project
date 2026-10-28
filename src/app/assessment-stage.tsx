"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import type { AssessmentState, StartedAttempt, SubmittedAttempt } from "../contracts/assessment";
import type { Study } from "../modules/materials-setup/service";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void };
type AssessmentResponse = AssessmentState & { objectIds: string[] };

const nodeCopy: Record<AssessmentState["node"], string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

// Epic-3 story-1 tracer stage: the visible scored path over a ready course —
// disclosure (threshold, available points, scoring criteria BEFORE any
// start) → options → one submission → honest threshold-boundary result with
// full attempt history → the derived roadmap line (In progress → Completed).
// The unrounded comparison decides Pass/Not passed and the display never
// contradicts it (79.96% does not pass an 80% mark); correct answers appear
// only after that attempt is graded; previous attempts stay listed, never
// overwritten; nothing here creates recovery, partial credit, gap guidance or
// any award — those belong to later entries.
export function AssessmentStage({ study, busy, onBusy, onFailure }: Props) {
  const [state, setState] = useState<AssessmentResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [choices, setChoices] = useState<Record<number, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef(onFailure);
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  // The submit command envelope per attempt: a lost response replays the SAME
  // command (the receipt machinery returns the identical result); a new
  // attempt always runs under a fresh start command.
  const keys = useRef(new Map<string, ReturnType<typeof command>>());
  const intent = (name: string) => {
    const key = `${name}:${study.revision}`;
    let value = keys.current.get(key);
    if (!value) { value = command(study.revision); keys.current.set(key, value); }
    return value;
  };
  const refresh = useCallback(async () => {
    const value = await api<AssessmentResponse>(`studies/${study.rootId}/assessment`);
    setState(value);
    return value;
  }, [study.rootId]);
  // The mount key includes the revision, so a re-confirmed study remounts with
  // empty state. The assessment depends on the course being READY, which this
  // stage does not own: while the honest state is still `none` (course not
  // generated / still generating) a quiet 2-second re-read keeps the panel
  // appearing when the course settles — polling never steals focus and stops
  // as soon as any real state exists.
  const empty = state === null || state.state === "none";
  useEffect(() => {
    let live = true;
    const read = () => { void api<AssessmentResponse>(`studies/${study.rootId}/assessment`).then(value => { if (live) setState(value); }).catch(error => { if (live) failureRef.current(error); }); };
    read();
    if (!empty) return () => { live = false; };
    const timer = setInterval(read, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [study.rootId, empty]);
  async function act(work: () => Promise<void>) {
    onBusy(true); setNotice("");
    try { await work(); } catch (error) { onFailure(error); } finally { onBusy(false); }
  }
  // Every start (first or retake) is a FRESH command: while an attempt is
  // open the server returns that same pinned attempt, so a double click can
  // never create a parallel duplicate; after a graded row the fresh command
  // legitimately opens the retake (no pedagogical attempt limit — D3).
  const start = () => act(async () => {
    await api<StartedAttempt>(`studies/${study.rootId}/assessment`, json(command(study.revision)));
    await refresh(); setChoices({});
    setNotice("Attempt started — the question set is pinned to this course version. It submits exactly once.");
    requestAnimationFrame(() => heading.current?.focus());
  });
  const submit = (attemptId: string) => act(async () => {
    const answers = Object.entries(choices).map(([position, choiceId]) => ({ position: Number(position), choiceId }));
    const result = await api<SubmittedAttempt>(`studies/${study.rootId}/assessment/${attemptId}/submit`, json({ ...intent(`submit-${attemptId}`), attemptId, answers }));
    await refresh(); setChoices({});
    setNotice(result.verdict);
    requestAnimationFrame(() => resultHeading.current?.focus());
  });
  if (!state || state.state === "none") return null;
  const test = state.test;
  const active = state.state === "active" && state.attempt && !("gradedAt" in state.attempt) ? state.attempt : null;
  const graded = state.state === "graded" && state.attempt && "gradedAt" in state.attempt ? state.attempt : null;
  const answered = active ? active.items.filter(item => choices[item.position]).length : 0;
  return <section className="panel"><p className="eyebrow">REQUIRED TEST · SCORED ATTEMPT TRACER</p><h3 ref={heading} tabIndex={-1}>Assessment &amp; progress</h3>
    <output>{notice}</output>
    <p><strong>Roadmap: {nodeCopy[state.node]}.</strong> <span className="fine">Derived, never awarded — Completed requires every required course item done and a passed attempt on the current course version. Review never revokes it.</span></p>
    {test && <div className="tracker-row">
      <p><strong>{test.title}</strong> <span className="fine">· {test.itemCount} items · {test.itemPoints.join(" + ")} = {test.totalPoints} points</span></p>
      <p><strong>Pass mark: {test.passMarkPercent}%</strong> — shown before you start. The unrounded earned-points comparison decides; the display never rounds a Not passed into looking like a pass.</p>
      <p className="fine"><strong>Scoring criteria:</strong> {test.answerRule} {test.rubric} Source: manually authored synthetic fixture — no live AI, no generated questions.</p>
    </div>}
    {state.state === "offered" && <>
      <p>One required test is available for this mini-course. The threshold, available points and scoring criteria above apply before you start; your answers submit exactly once and previous attempts stay listed.</p>
      <div className="actions"><button disabled={busy} onClick={() => { void start(); }}>Start the required test</button></div>
      <p className="fine">Correct answers are withheld until your attempt is graded. There is no time limit.</p>
    </>}
    {active && <>
      <p>Attempt open — {answered} of {active.items.length} answered. Pinned to course version {active.courseVersion}; a newer version would not change this attempt&apos;s questions or verdict.</p>
      <form onSubmit={event => { event.preventDefault(); void submit(active.attemptId); }}>
        {active.items.map(item => <fieldset key={item.position} disabled={busy}>
          <legend>Item {item.position} of {active.items.length} · {item.points} points · objective: {item.objective}</legend>
          <p>{item.prompt}</p>
          {item.choices.map(option => <div className="answer-row" key={option.id}>
            <input type="radio" id={`test-choice-${item.position}-${option.id}`} name={`test-choice-${item.position}`} value={option.id} checked={choices[item.position] === option.id} onChange={() => setChoices(previous => ({ ...previous, [item.position]: option.id }))} />
            <label htmlFor={`test-choice-${item.position}-${option.id}`}>{option.text}</label>
          </div>)}
        </fieldset>)}
        <div className="actions"><button type="submit" disabled={busy || answered < active.items.length}>Submit test ({answered}/{active.items.length} answered)</button></div>
      </form>
      <p className="fine">The attempt submits exactly once — choose an answer for every item first. An unanswered item would score zero under the full-credit rubric.</p>
    </>}
    {graded && <>
      <h4 ref={resultHeading} tabIndex={-1}>Result</h4>
      <div className="notice"><p><strong>{graded.verdict}</strong> — {graded.earnedPoints}/{graded.totalPoints} points. The unrounded comparison decided this; one decimal is shown only when it cannot contradict the verdict.</p></div>
      <p className="fine">Attempt {graded.attemptId.slice(0, 8)}… · course version {graded.courseVersion} · graded {new Date(graded.gradedAt).toLocaleString()} · started {new Date(graded.startedAt).toLocaleString()}.</p>
      {graded.items.map(item => <fieldset key={item.position}>
        <legend>Item {item.position} · {item.earned === item.points ? `correct · ${item.points} points` : item.chosenChoiceId === null ? "unanswered · 0 points" : "not correct · 0 points"}</legend>
        <p>{item.prompt}</p>
        <p><strong>Correct answer:</strong> {item.choices.find(choice => choice.id === item.correctChoiceId)?.text ?? item.correctChoiceId}{item.chosenChoiceId !== null && item.chosenChoiceId !== item.correctChoiceId && <> — your answer: {item.choices.find(choice => choice.id === item.chosenChoiceId)?.text ?? item.chosenChoiceId}</>}</p>
        <p className="fine">Objective: {item.objective} · {item.points} points.</p>
      </fieldset>)}
      <div className="actions"><button disabled={busy} onClick={() => { void start(); }}>Start a new attempt</button></div>
      <p className="fine">No pedagogical attempt limit — a fresh attempt is always offered, never forced. This tracer has no recovery path, partial credit or gap guidance; those belong to later entries.</p>
    </>}
    {state.attempts.length > 0 && <div className="tracker-row">
      <p><strong>Attempt history</strong> <span className="fine">· listed, never overwritten</span></p>
      <ul>{state.attempts.map(attempt => <li key={attempt.attemptId} className="fine">
        {new Date(attempt.startedAt).toLocaleString()} · course version {attempt.courseVersion} · {attempt.status === "active" ? "open — not yet submitted" : `${attempt.displayPercent} — ${attempt.passed ? "Pass" : "Not passed"} (${attempt.earnedPoints}/${attempt.totalPoints})`}
      </li>)}</ul>
    </div>}
  </section>;
}

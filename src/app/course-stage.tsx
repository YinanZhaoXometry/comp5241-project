"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import type { CourseState, RecallFeedback } from "../contracts/courses";
import type { Study } from "../modules/materials-setup/service";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void };
type Disclosure = { configuration: { eligibility: "eligible" | "ineligible"; provider: string }; decision: "none" | "granted" | "declined" | "withdrawn" };
type CourseResponse = CourseState & { objectIds: string[] };

const failureCopy: Record<string, string> = {
  "invalid-output": "The generated draft did not validate against your confirmed plan and sources — rejected, not repaired. Nothing was saved.",
  "rejected-late": "Consent or your plan changed while generating; the result was discarded. Nothing was saved.",
  "processing-blocked": "Generation could not finish. Nothing was saved; retry when available.",
  timeout: "Generation is taking longer than 120 seconds. It was not retried; you can request it again.",
};

// Epic-2 S1 tracer stage: the thinnest confirmed-plan-to-course path. One
// generation command per confirmed revision; the served course is labeled
// AI-generated · Unreviewed with per-section source locations and a version
// line; the recall card withholds its answer until submission. Nothing here
// awards completion, scores or credit — studying is reading, not passing.
export function CourseStage({ study, busy, onBusy, onFailure }: Props) {
  const [state, setState] = useState<CourseResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [generating, setGenerating] = useState(false);
  const [attempt, setAttempt] = useState("");
  const [feedback, setFeedback] = useState<RecallFeedback | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentKey = useRef<ReturnType<typeof command> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef(onFailure);
  const rootId = study.rootId;
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  const stopPolling = useCallback(() => { if (poll.current) { clearInterval(poll.current); poll.current = null; } }, []);
  // The disclosure is re-read on mount and, while generation is still gated,
  // every few seconds — so an owner grant made in the Privacy & data panel
  // below opens this action without a remount. Once granted (or when the
  // stage goes away) the re-read stops; polling never steals focus.
  useEffect(() => {
    let live = true;
    const read = () => { void api<Disclosure>("processing").then(value => { if (live) setDisclosure(value); }).catch(() => { /* stays ungated */ }); };
    read();
    let timer: ReturnType<typeof setInterval> | null = null;
    if (disclosure?.decision !== "granted") timer = setInterval(read, 3000);
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [disclosure?.decision]);
  // The mount key includes the study revision, so a re-confirmed study remounts
  // this stage with empty recall/notice state; no synchronous reset is needed
  // inside the effect.
  useEffect(() => {
    let live = true;
    void api<CourseResponse>(`studies/${rootId}/course`).then(value => { if (live) setState(value); }).catch(error => { if (live) failureRef.current(error); });
    return () => { live = false; };
  }, [rootId]);

  const generate = async (fresh: boolean) => {
    // Reuse the envelope within one attempt (a lost response replays through
    // the command_receipt machinery); an explicit retry after failure mints a
    // NEW command, which is the only path that may dispatch again.
    if (fresh || !intentKey.current) intentKey.current = command(study.revision);
    const envelope = intentKey.current;
    onBusy(true); setGenerating(true); setNotice(""); setFeedback(null);
    const started = Date.now();
    try {
      await api(`studies/${rootId}/course`, json(envelope));
      await new Promise<void>((resolve, reject) => {
        stopPolling();
        poll.current = setInterval(() => {
          void api<CourseResponse>(`studies/${rootId}/course`).then(value => {
            if (value.state === "pending") {
              // Honest pending cap: past 120 seconds the UI stops waiting, but
              // first re-fetches the server-authoritative state so the panel
              // never falls back to its stale mount-time view while the row is
              // honestly still pending (mirrors ai-assist's timeout handling).
              if (Date.now() - started > 120_000) {
                stopPolling();
                setState(value);
                setNotice("Generation is taking longer than 120 seconds. It was not retried; you can return later or request it again.");
                resolve();
              }
              return;
            }
            stopPolling();
            setState(value); resolve();
          }).catch(error => { stopPolling(); reject(error); });
        }, 1000);
      });
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      failureRef.current(error);
    } finally { onBusy(false); setGenerating(false); }
  };

  const submit = async () => {
    if (!attempt.trim()) return;
    onBusy(true); setNotice("");
    try {
      const result = await api<RecallFeedback>(`studies/${rootId}/course/recall`, json({ ...command(study.revision), attempted: attempt }));
      setFeedback(result);
      requestAnimationFrame(() => feedbackRef.current?.focus());
    } catch (error) {
      failureRef.current(error);
    } finally { onBusy(false); }
  };

    if (!state) return null;
    const granted = disclosure?.configuration.eligibility === "eligible" && disclosure.decision === "granted";
    const inFlight = generating && state.state !== "ready" && state.state !== "failed";
    return <section className="panel"><p className="eyebrow">GENERATED MINI-COURSE · TRACER</p><h3 ref={heading} tabIndex={-1}>Your mini-course</h3>
    <output>{notice}</output>
    {state.state === "none" && !inFlight && <>
      <p>Plan confirmed — course not generated.</p>
      <div className="actions">
        <button disabled={busy || generating || !granted} onClick={() => { void generate(false); }}>{generating ? "Generating…" : "Generate mini-course (AI)"}</button>
      </div>
      <p className="fine">{granted
        ? "Generation runs the local synthetic fixture on this machine — no external dispatch in this version (live admission is deferred). One command per confirmed plan revision; the result is labeled AI-generated and unreviewed."
        : "Allow processing for the current disclosure in the Privacy & data panel below first; declination keeps every Manual path working and nothing generates while processing is not allowed."}</p>
    </>}
    {(state.state === "pending" || inFlight) && <>
      <p>Course generating — you can return later. {state.state === "pending" ? <>Reference {state.requestId.slice(0, 8)}… </> : null}(at most 120 seconds).</p>
      <p className="fine">Nothing is shown as ready until the server says so.</p>
    </>}
    {state.state === "failed" && <>
      <p>Generation failed — nothing was saved. {failureCopy[state.failureCode ?? ""] ?? `Reason: ${state.failureCode ?? "unknown"}.`}</p>
      <div className="actions"><button disabled={busy || generating} onClick={() => { void generate(true); }}>Retry generation</button></div>
    </>}
    {state.state === "ready" && (() => {
      const course = state.course;
      return <>
        <p><strong>AI-generated · Unreviewed</strong> — review everything against your own sources. Version {course.version} · generated {new Date(course.createdAt).toLocaleString()} · model {course.model || "unknown"} · provider-claimed tokens {course.usage?.totalTokens ?? 0} (untrusted count).</p>
        {course.historical && <p className="fine">This course belongs to a previous confirmed plan version; re-confirm and generate again for the current one.</p>}
        {course.superseded && !course.historical && <p className="fine">A newer version of this course exists; this version stays readable as studied.</p>}
        <h4>{course.lesson.title}</h4>
        {course.lesson.sections.map((section, index) => <div key={index} className="lesson-section">
          <p>{section.text}</p>
          <p className="fine">Source: {section.source.filename} · {section.source.locator}</p>
        </div>)}
        <h4>Objectives covered</h4>
        <ul>{course.objectives.map(objective => <li key={objective.index}>{objective.text}</li>)}</ul>
        <fieldset>
          <legend>Recall item · answer withheld until you submit</legend>
          <p>{course.recall.prompt}</p>
          <p className="fine">Objective: {course.recall.objective || "linked objective"} · Source: {course.recall.source.filename} · {course.recall.source.locator}</p>
          {!feedback && <div className="actions">
            <label htmlFor="recall-attempt">Your answer</label>
            <textarea id="recall-attempt" rows={3} maxLength={2000} value={attempt} onChange={event => setAttempt(event.target.value)} />
            <button disabled={busy || !attempt.trim()} onClick={() => { void submit(); }}>Submit recall answer</button>
          </div>}
          {feedback && <div className="feedback" ref={feedbackRef} tabIndex={-1}>
            <p><strong>{feedback.outcome === "correct" ? "Correct" : "Not correct"}.</strong> Attempt-before-answer evidence with uncertainty, not a grade.</p>
            <p><strong>Canonical answer:</strong> {feedback.answer}</p>
            <p><strong>Rationale:</strong> {feedback.rationale}</p>
            <p className="fine">Source: {feedback.source.filename} · {feedback.source.locator}</p>
          </div>}
        </fieldset>
      </>;
    })()}
  </section>;
}

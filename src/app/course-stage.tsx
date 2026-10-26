"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import type { CourseState, RecallFeedback, SupplementsState } from "../contracts/courses";
import type { Study } from "../modules/materials-setup/service";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void };
type Disclosure = { configuration: { eligibility: "eligible" | "ineligible"; provider: string }; decision: "none" | "granted" | "declined" | "withdrawn" };
type CourseResponse = CourseState & { objectIds: string[] };
type SupplementsResponse = SupplementsState & { objectIds: string[] };

const failureCopy: Record<string, string> = {
  "invalid-output": "The generated draft did not validate against your confirmed plan and sources — rejected, not repaired. Nothing was saved.",
  "rejected-late": "Consent or your plan changed while generating; the result was discarded. Nothing was saved.",
  "processing-blocked": "Generation could not finish. Nothing was saved; retry when available.",
  timeout: "Generation is taking longer than 120 seconds. It was not retried; you can request it again.",
};

const supplementFailureCopy: Record<string, string> = {
  "fetch-unavailable": "Live source fetch is not admitted in this version — nothing left this machine and nothing was saved.",
  "fetch-timeout": "Fetching a proposed source took longer than the bound. It was not retried; nothing was saved.",
  "fetch-transport": "A proposed source could not be fetched. Nothing was saved.",
  "fetch-status": "A proposed source answered with an error. Nothing was saved.",
  "invalid-output": "The proposed sources did not validate against your plan's gaps — rejected, not repaired. Nothing was saved.",
  "rejected-late": "Consent or your course lineage changed while checking; the result was discarded. Nothing was saved.",
  "processing-blocked": "The supplement check could not finish. Nothing was saved; retry when available.",
  timeout: "The supplement check is taking longer than 120 seconds. It was not retried; you can request it again.",
};
function supplementFailureText(code: string | null | undefined): string {
  if (code && code.startsWith("fetch-denied:")) return `The fetch boundary rejected a proposed source (${code.slice("fetch-denied:".length)}). Nothing was saved.`;
  return supplementFailureCopy[code ?? ""] ?? `Reason: ${code ?? "unknown"}. Nothing was saved.`;
}

// Epic-2 S1 tracer stage: the thinnest confirmed-plan-to-course path. One
// generation command per confirmed revision; the served course is labeled
// AI-generated · Unreviewed with per-section source locations and a version
// line; the recall card withholds its answer until submission. Nothing here
// awards completion, scores or credit — studying is reading, not passing.
// Epic-2 S2 adds the "Gaps & supplements" section over the ready view: the
// plan's declared gaps, a consent-gated check against allowlisted public
// sources through the bounded fetcher, and honest supported / side-by-side
// conflict / unsupported states — supplements are badged, never silently
// replace an upload, and never become a scored item.
export function CourseStage({ study, busy, onBusy, onFailure }: Props) {
  const [state, setState] = useState<CourseResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [generating, setGenerating] = useState(false);
  const [attempt, setAttempt] = useState("");
  const [feedback, setFeedback] = useState<RecallFeedback | null>(null);
  const [supplements, setSupplements] = useState<SupplementsResponse | null>(null);
  const [supplementing, setSupplementing] = useState(false);
  const [supplementReload, setSupplementReload] = useState(0);
  const [supplementLoadFailedFor, setSupplementLoadFailedFor] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const supPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentKey = useRef<ReturnType<typeof command> | null>(null);
  const supKey = useRef<ReturnType<typeof command> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const supHeading = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef(onFailure);
  const rootId = study.rootId;
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  const stopPolling = useCallback(() => { if (poll.current) { clearInterval(poll.current); poll.current = null; } }, []);
  const stopSupPolling = useCallback(() => { if (supPoll.current) { clearInterval(supPoll.current); supPoll.current = null; } }, []);
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
  // The supplement state is read for exactly the ready course version being
  // displayed (course id pinned in the query), so a superseded course keeps
  // its own supplement record readable. A state fetched for a different
  // course version is simply not rendered — no synchronous reset needed. A
  // failed read is recorded per course id and surfaced honestly below with a
  // re-read action instead of an eternal "loading" state.
  const readyCourseId = state?.state === "ready" ? state.course.courseId : null;
  useEffect(() => {
    if (!readyCourseId) return;
    let live = true;
    void api<SupplementsResponse>(`studies/${rootId}/supplements?course=${readyCourseId}`)
      .then(value => { if (live) { setSupplements(value); setSupplementLoadFailedFor(null); } })
      .catch(() => { if (live) setSupplementLoadFailedFor(readyCourseId); });
    return () => { live = false; };
  }, [rootId, readyCourseId, supplementReload]);
  const supplementsView = supplements && supplements.courseId === readyCourseId ? supplements : null;
  const supplementsLoadFailed = !!readyCourseId && !supplementsView && supplementLoadFailedFor === readyCourseId;

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

  const checkSupplements = async (fresh: boolean) => {
    if (!readyCourseId) return;
    if (fresh || !supKey.current) supKey.current = command(study.revision);
    const envelope = supKey.current;
    onBusy(true); setSupplementing(true); setNotice("");
    const started = Date.now();
    try {
      await api(`studies/${rootId}/supplements`, json({ ...envelope, courseId: readyCourseId }));
      await new Promise<void>((resolve, reject) => {
        stopSupPolling();
        supPoll.current = setInterval(() => {
          void api<SupplementsResponse>(`studies/${rootId}/supplements?course=${readyCourseId}`).then(value => {
            if (value.state === "pending") {
              if (Date.now() - started > 120_000) {
                stopSupPolling();
                setSupplements(value);
                setNotice("The supplement check is taking longer than 120 seconds. It was not retried; you can return later or request it again.");
                resolve();
              }
              return;
            }
            stopSupPolling();
            setSupplements(value); resolve();
          }).catch(error => { stopSupPolling(); reject(error); });
        }, 1000);
      });
      requestAnimationFrame(() => supHeading.current?.focus());
    } catch (error) {
      failureRef.current(error);
    } finally { onBusy(false); setSupplementing(false); }
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
    const supPending = supplementing || supplements?.state === "pending";
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
        <h4 ref={supHeading} tabIndex={-1}>Gaps &amp; supplements</h4>
        <p className="fine">Your plan declared what your own sources do not explain. A supplement pass proposes allowlisted public reference pages, fetches them through this machine&apos;s bounded fetcher, and shows only passages verified against the fetched page — never the model&apos;s word alone. Supplements are badged, never replace your uploads, and never become scored items.</p>
        {!supplementsView && !supplementsLoadFailed && <p className="fine">Loading supplement state…</p>}
        {supplementsLoadFailed && <>
          <p>Supplement state could not be loaded. Your course and recall work are unchanged.</p>
          <div className="actions"><button disabled={busy || supplementing} onClick={() => { setSupplementReload(value => value + 1); }}>Re-read supplement state</button></div>
        </>}
        {supplementsView && supplementsView.gapsTruncated && <p className="fine">Your plan declares {supplementsView.gapCount} gaps; the first {supplementsView.gaps.length} are supplementable in this release.</p>}
        {supplementsView && supplementsView.gaps.length === 0 && <p className="fine">Your plan declares no missing explanations — nothing to supplement.</p>}
        {supplementsView && supplementsView.state === "none" && supplementsView.gaps.length > 0 && <>
          <ul>{supplementsView.gaps.map(({ gap }) => <li key={gap.index}>{gap.description} <span className="fine">· outcome: {gap.objective || "linked outcome"} · Not checked yet</span></li>)}</ul>
          <div className="actions">
            <button disabled={busy || supplementing || !granted} onClick={() => { void checkSupplements(false); }}>{supplementing ? "Checking…" : "Check gaps against public sources (AI)"}</button>
          </div>
          <p className="fine">{granted
            ? "The proposal runs the local synthetic fixture and the fetch runs the local deterministic fetch fixture — no network egress in this version (live admissions are deferred)."
            : "Allow processing for the current disclosure in the Privacy & data panel below first; nothing is proposed or fetched while processing is not allowed."}</p>
        </>}
        {supplementsView && supPending && supplementsView.state !== "none" && <>
          <p>Checking gaps against public sources — you can return later. {supplementsView.state === "pending" && supplementsView.requestId ? <>Reference {supplementsView.requestId.slice(0, 8)}… </> : null}(at most 120 seconds).</p>
          <p className="fine">Nothing is shown as verified until the server says so.</p>
        </>}
        {supplementsView && supplementsView.state === "failed" && <>
          <p>Supplement check failed — nothing was saved. {supplementFailureText(supplementsView.failureCode)}</p>
          <div className="actions"><button disabled={busy || supplementing} onClick={() => { void checkSupplements(true); }}>Retry supplement check</button></div>
        </>}
        {supplementsView && supplementsView.state === "ready" && <ul>{supplementsView.gaps.map(({ gap, outcome, supplement }) => <li key={gap.index} className="lesson-section">
          {outcome === "unaddressed" && <p>{gap.description} <span className="fine">· still unaddressed</span></p>}
          {outcome === "unsupported" && <>
            <p><strong>Checked, unsupported.</strong> {gap.description}</p>
            <p className="fine">The claimed passage was not found in the fetched source{supplement?.retrievedAt ? ` (checked ${new Date(supplement.retrievedAt).toLocaleString()})` : ""}; no supplement content was added.</p>
          </>}
          {outcome === "supported" && supplement && <>
            <p><strong>Supplement — external source</strong> (for: {supplement.claim})</p>
            <p>{supplement.passage}</p>
            <p className="fine">Source: {supplement.origin} ({supplement.url}) · {supplement.locator} · retrieved {supplement.retrievedAt ? new Date(supplement.retrievedAt).toLocaleString() : ""} · content sha256 {supplement.contentHash?.slice(0, 16)}…</p>
          </>}
          {outcome === "conflict" && supplement && supplement.conflict && <>
            <p><strong>Supplement — external source · Conflict — both sources shown</strong> (for: {supplement.claim})</p>
            <div className="feedback">
              <p><strong>Your upload says:</strong> {supplement.conflict.uploadExcerpt}</p>
              <p className="fine">From {supplement.conflict.uploadSource}</p>
              <p><strong>The public source says:</strong> {supplement.passage}</p>
              <p className="fine">Source: {supplement.origin} ({supplement.url}) · {supplement.locator} · retrieved {supplement.retrievedAt ? new Date(supplement.retrievedAt).toLocaleString() : ""} · content sha256 {supplement.contentHash?.slice(0, 16)}… — shown beside your upload, never resolved silently.</p>
            </div>
          </>}
        </li>)}</ul>}
      </>;
    })()}
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import type { Command } from "../contracts/setup";
import type { CourseItemView, CourseState, CourseView, RecallFeedback, SupplementsState } from "../contracts/courses";
import type { Study } from "../modules/materials-setup/service";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void; onCourseReady?: () => void };
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

// Epic-2 S3 player shell over the S1 tracer stage: the course view became the
// spine's player — numbered lesson sequence, sticky sidebar collapsing under
// 850px, and a content-item tracker whose done state is ONLY the learner's
// explicit mark-done (server-persisted per owner and course version; nothing
// about dwell, scroll or visibility is ever tracked). Required items are the
// lessons' own readings; optional enrichment is labeled and never blocks
// navigation or anything else. Honest processing/empty/version-superseded
// states, media-floor copy and the shared help footer close the panel. The
// epic-6 deferral stands: the player renders lesson text and tracker items
// only and claims nothing about simulations, role play, games, slides or
// coding. S2's "Gaps & supplements" section rides along unchanged.
export function CourseStage({ study, busy, onBusy, onFailure, onCourseReady }: Props) {
  const [state, setState] = useState<CourseResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [trackerNotice, setTrackerNotice] = useState("");
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [generating, setGenerating] = useState(false);
  const [attempt, setAttempt] = useState("");
  const [feedback, setFeedback] = useState<RecallFeedback | null>(null);
  const [supplements, setSupplements] = useState<SupplementsResponse | null>(null);
  const [supplementing, setSupplementing] = useState(false);
  const [supplementReload, setSupplementReload] = useState(0);
  const [supplementLoadFailedFor, setSupplementLoadFailedFor] = useState<string | null>(null);
  // The selected lesson is derived state keyed by the ready course id: a new
  // course version resets the player to lesson 1 with no synchronous reset
  // effect (each version carries its own tracker state).
  const [lessonSelection, setLessonSelection] = useState<{ courseId: string; number: number }>({ courseId: "", number: 1 });
  // The STUDIED course version, pinned once from the default view: every
  // steady-state read goes through ?course=<pinned id> so a regeneration
  // settling elsewhere can never silently swap the studied version or its
  // tracker view. The pin moves ONLY through the player's explicit version
  // actions — generating the current plan's course, or the switch below — and
  // a pinned older version then reaches the superseded state in-shell.
  const [pinnedCourseId, setPinnedCourseId] = useState<string | null>(null);
  // The offered newer version's course view, fetched to show what changed
  // (lesson titles + required item ids) beside the explicit switch (D1).
  const [offered, setOffered] = useState<{ version: number; course: CourseView } | null>(null);
  const [offeredFailed, setOfferedFailed] = useState<number | null>(null);
  // Per-item mark-done envelopes kept as state (not a ref): a lost response
  // replays the SAME command on the next click of that item; a fresh item
  // mints a fresh command. The server's UNIQUE row keeps any duplicate a
  // structural no-op either way.
  const [trackEnvelopes, setTrackEnvelopes] = useState(new Map<string, Command>());
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const supPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentKey = useRef<ReturnType<typeof command> | null>(null);
  const supKey = useRef<ReturnType<typeof command> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lessonHeading = useRef<HTMLHeadingElement>(null);
  const trackerStatus = useRef<HTMLParagraphElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const supHeading = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef(onFailure);
  const courseReadyRef = useRef(onCourseReady);
  const rootId = study.rootId;
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  useEffect(() => { courseReadyRef.current = onCourseReady; }, [onCourseReady]);
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
  // inside the effect. The initial read is the DEFAULT view and pins the
  // studied version from it once — every later steady-state read goes through
  // the pinned selector.
  useEffect(() => {
    let live = true;
    void api<CourseResponse>(`studies/${rootId}/course`).then(value => {
      if (!live) return;
      setState(value);
      if (value.state === "ready") setPinnedCourseId(value.course.courseId);
    }).catch(error => { if (live) failureRef.current(error); });
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
  const selectedLesson = readyCourseId !== null && lessonSelection.courseId === readyCourseId ? lessonSelection.number : 1;
  // When the pinned view is superseded, the offered newer version is fetched
  // once so the switch can SHOW what changed before the learner moves (D1).
  const supersededOffer = state?.state === "ready" && state.course.superseded && state.course.supersededBy !== null ? state.course.supersededBy : null;
  useEffect(() => {
    if (supersededOffer === null) return;
    let live = true;
    void api<CourseResponse>(`studies/${rootId}/course?course=${supersededOffer}`).then(value => {
      if (!live) return;
      if (value.state === "ready") setOffered({ version: supersededOffer, course: value.course });
      else setOfferedFailed(supersededOffer);
    }).catch(() => { if (live) setOfferedFailed(supersededOffer); });
    return () => { live = false; };
  }, [supersededOffer, rootId]);

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
      const final = await new Promise<CourseResponse>((resolve, reject) => {
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
                resolve(value);
              }
              return;
            }
            stopPolling();
            setState(value); resolve(value);
          }).catch(error => { stopPolling(); reject(error); });
        }, 1000);
      });
      // A freshly generated course flips the study's course-generated signal:
      // let the shell re-read the study so the plan panel heading and library
      // line stop claiming "course not generated" without a reopen. The
      // generation command is an explicit version action, so the pin moves to
      // the newly settled course.
      if (final.state === "ready") { setPinnedCourseId(final.course.courseId); courseReadyRef.current?.(); }
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

  // Explicit mark-done of one required item. The envelope is reused per item
  // within one attempt (a lost response replays the same command); the server
  // keeps done state per owner AND course version, so nothing is inferred and
  // nothing else changes. Ref-free by construction: the focus choreography
  // rides the tracker-notice effect below.
  async function markDone(itemId: string) {
    if (!readyCourseId) return;
    const existing = trackEnvelopes.get(itemId);
    const envelope = existing ?? command(study.revision);
    if (!existing) setTrackEnvelopes(previous => new Map(previous).set(itemId, envelope));
    onBusy(true); setTrackerNotice("");
    try {
      await api(`studies/${rootId}/course/track`, json({ ...envelope, courseId: readyCourseId, itemId }));
      // Re-read through the PINNED selector: the studied version (and its
      // tracker view) stays put even if a regeneration settled elsewhere —
      // at most this read reveals the honest superseded notice in-shell.
      const value = await api<CourseResponse>(`studies/${rootId}/course${pinnedCourseId ? `?course=${pinnedCourseId}` : ""}`);
      setState(value);
      setTrackerNotice("Marked done — your explicit action, recorded for this course version. Nothing else was inferred or unlocked.");
    } catch (error) {
      onFailure(error);
    } finally { onBusy(false); }
  }

  // The explicit version switch: re-read the DEFAULT view (the newest course
  // of the current confirmed plan) and re-pin to it. The studied version kept
  // its own tracker state server-side the whole time.
  async function readCurrent() {
    onBusy(true);
    try {
      const value = await api<CourseResponse>(`studies/${rootId}/course`);
      setState(value);
      setPinnedCourseId(value.state === "ready" ? value.course.courseId : null);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      failureRef.current(error);
    } finally { onBusy(false); }
  }

  function selectLesson(number: number) {
    setLessonSelection({ courseId: readyCourseId ?? "", number });
  }
  // Focus choreography (effects, never render reads): lesson navigation moves
  // focus to the selected lesson's heading; a completed mark-done moves focus
  // to the tracker row's status line and announces politely via the live
  // region rendered beside it.
  useEffect(() => {
    if (lessonSelection.courseId !== "") requestAnimationFrame(() => lessonHeading.current?.focus());
  }, [lessonSelection]);
  useEffect(() => {
    if (trackerNotice) requestAnimationFrame(() => trackerStatus.current?.focus());
  }, [trackerNotice]);

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
      const lesson = course.lessons[selectedLesson - 1] ?? course.lessons[0];
      const shown = lesson.number;
      const lessonItem = (number: number) => course.items.find(item => item.required && item.lessonNumber === number) ?? null;
      const optionalItems = course.items.filter(item => !item.required);
      const currentItem = lessonItem(shown);
      return <>
        <p><strong>AI-generated · Unreviewed</strong> — review everything against your own sources. Version {course.version} · generated {new Date(course.createdAt).toLocaleString()} · model {course.model || "unknown"} · provider-claimed tokens {course.usage?.totalTokens ?? 0} (untrusted count).</p>
        {course.adaptation && course.adaptation.track !== "neutral" && <p className="fine">Pitched for: {course.adaptation.track === "beginner"
          ? "a non-CS beginner — plain language, familiar examples, explicit prerequisites"
          : "an experienced-developer level — application scenarios and trade-off depth"}{course.adaptation.backgroundSummary ? <> (from your stated background: “{course.adaptation.backgroundSummary}”)</> : null}. Only the framing is pitched; every factual claim, lesson and source link is identical across tracks, and a background that cannot be classified would generate the same course neutrally.</p>}
        {(course.historical || course.superseded) && <div className="notice">
          <p>{course.historical && "This course belongs to a previous confirmed plan version; it stays as studied until you switch. "}{course.superseded && <>A newer version of this course exists{course.supersededBy ? ` (version ${course.supersededBy}, generated from a newer confirmed plan)` : ""}; this version keeps its own tracker state until you switch.</>}</p>
          <div className="actions">
            {course.historical && <button disabled={busy || generating || !granted} onClick={() => { void generate(false); }}>{generating ? "Generating…" : "Generate the current plan's course (AI)"}</button>}
            {course.superseded && <button className="secondary" disabled={busy} onClick={() => { void readCurrent(); }}>Switch to the current generated version{course.supersededBy ? ` (version ${course.supersededBy})` : ""}</button>}
          </div>
          {course.historical && !granted && <p className="fine">Allow processing for the current disclosure in the Privacy &amp; data panel below first; the studied version stays readable either way.</p>}
          {course.superseded && course.supersededBy !== null && (offered && offered.version === course.supersededBy
            ? <p className="fine">Changed required work before you switch to version {course.supersededBy}: {requiredWorkDiff(course, offered.course).join(" · ") || "no changes to lessons or required items."}</p>
            : offeredFailed === course.supersededBy
              ? <p className="fine">What changed in version {course.supersededBy} could not be loaded; switching stays explicit and this version stays as studied.</p>
              : <p className="fine">Loading what changed in version {course.supersededBy}…</p>)}
        </div>}
        <div className="player">
          <aside className="player-side" aria-label="Lesson sequence and content-item tracker">
            <p className="eyebrow">LESSONS</p>
            <ol className="lesson-nav">
              {course.lessons.map(entry => {
                const item = lessonItem(entry.number);
                return <li key={entry.number}><button type="button" aria-current={entry.number === shown ? "true" : undefined} onClick={() => { selectLesson(entry.number); }}>
                  <span><span className="lesson-no">{entry.number}.</span> {entry.title}</span>
                  <span className="fine">{item?.done ? "Reading done" : "Required reading"}</span>
                </button></li>;
              })}
            </ol>
            <p className="eyebrow">CONTENT-ITEM TRACKER</p>
            <ul className="tracker-list">
              {course.items.map(item => <li key={item.id}>
                <span>{item.required ? "Required" : "Optional — never blocks"}</span>
                <span>{item.title}</span>
                <span className="fine">{item.done ? `Done · ${new Date(item.doneAt ?? "").toLocaleString()}` : item.required ? "Not done yet" : "No tracking — read if you want"}</span>
              </li>)}
            </ul>
            <p className="fine">Done is only your explicit mark on a required item. Nothing about scrolling, time or visibility is recorded.</p>
          </aside>
          <div className="player-main">
            <article aria-label={`Lesson ${shown} of ${course.lessons.length}`}>
              <h4 ref={lessonHeading} tabIndex={-1}>{shown}. {lesson.title}</h4>
              {lesson.framing && <p className="fine">{lesson.framing}</p>}
              {lesson.sections.map((section, index) => <div key={index} className="lesson-section">
                <p>{section.text}</p>
                <p className="fine">Source: {section.source.filename} · {section.source.locator}</p>
              </div>)}
              {currentItem && <div className="tracker-row">
                <p ref={trackerStatus} tabIndex={-1}>{currentItem.done ? <><strong>Done.</strong> {currentItem.title}</> : <><strong>Required · not done.</strong> {currentItem.title}</>}</p>
                {currentItem.done
                  ? <p className="fine">Marked done {new Date(currentItem.doneAt ?? "").toLocaleString()} — an explicit learner action on this course version. Nothing was unlocked, scored or credited.</p>
                  : <div className="actions"><button disabled={busy} onClick={() => { void markDone(currentItem.id); }}>Mark lesson {shown} reading done</button></div>}
              </div>}
              <output className="fine tracker-status" aria-label="Content-item tracker status">{trackerNotice}</output>
            </article>
            {shown === course.lessons.length && optionalItems.length > 0 && optionalItems.map(item => <TrackerOptionalRow key={item.id} item={item} />)}
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
          </div>
        </div>
      </>;
    })()}
    <footer className="player-help">
      <p className="fine">Media floor: nothing here autoplays — this release&apos;s course content is text-only, and any future audio, video or animation will carry a visible stop control, a transcript and adjustable playback rate. Done is only your explicit mark; no dwell or scroll tracking exists.</p>
      <p className="fine">Help — account or recovery: contact the local operator. Report a problem: contact the local operator{readyCourseId ? <> with course reference {readyCourseId.slice(0, 8)}…</> : null}.</p>
    </footer>
  </section>;
}

// The labeled optional enrichment row: rendered content, honest labels, no
// mark-done, no blocking, no tracking — nothing about it ever counts.
function TrackerOptionalRow({ item }: { item: CourseItemView }) {
  return <div className="tracker-row">
    <p><strong>{item.title}</strong> <span className="fine">Optional — never blocks, never counted, no tracking.</span></p>
    {item.text && <p>{item.text}</p>}
    {item.source && <p className="fine">Source: {item.source.filename} · {item.source.locator}</p>}
  </div>;
}

// What changed between the studied version and the offered one, in REQUIRED
// WORK only (D1 — changed required work is shown before switching): lesson
// titles and required item ids, added and removed, never inferred.
function requiredWorkDiff(current: CourseView, offered: CourseView): string[] {
  const lines: string[] = [];
  const currentTitles = new Set(current.lessons.map(lesson => lesson.title));
  const offeredTitles = new Set(offered.lessons.map(lesson => lesson.title));
  for (const title of offeredTitles) if (!currentTitles.has(title)) lines.push(`new lesson “${title}”`);
  for (const title of currentTitles) if (!offeredTitles.has(title)) lines.push(`lesson “${title}” removed`);
  const currentItems = new Set(current.items.filter(item => item.required).map(item => item.id));
  const offeredItems = new Set(offered.items.filter(item => item.required).map(item => item.id));
  for (const id of offeredItems) if (!currentItems.has(id)) lines.push(`new required item ${id}`);
  for (const id of currentItems) if (!offeredItems.has(id)) lines.push(`required item ${id} removed`);
  return lines;
}

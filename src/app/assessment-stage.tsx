"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import type { AssessmentState, GradedItemView, StartedAttempt, StartedRetest, SubmittedAttempt, SubmittedRetest, SwitchDisclosure, SwitchedCourseVersion } from "../contracts/assessment";
import { displayPointsOf } from "../modules/assessment-progress/scoring";
import type { Study } from "../modules/materials-setup/service";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void };
type AssessmentResponse = AssessmentState & { objectIds: string[] };
type SwitchDisclosureResponse = SwitchDisclosure & { objectIds: string[] };

const nodeCopy: Record<AssessmentState["node"], string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

// Epic-3 story-1 tracer stage + the story-2 targeted-recovery chain + the
// story-3 scoring surface + the story-4 monotonic completion-award layer:
// the visible scored path over a ready course — disclosure (threshold,
// available points, scoring criteria BEFORE any start) → options → one
// submission → honest threshold-boundary result with full attempt history →
// the roadmap line (In progress → Completed). The unrounded comparison
// decides Pass/Not passed and the display never contradicts it (79.96% does
// not pass an 80% mark); correct answers appear only after that attempt is
// graded; previous attempts stay listed, never overwritten. Story 3: when an
// attempt's snapshot carries a disclosed partial-credit rubric, the
// disclosure shows it up front and each credited choice names its exact
// declared credit (never the correct answer); point amounts render through
// the snapshot's declared scale. A FAILED grade opens the recovery path: the
// failed view groups items per objective ("Needs practice", cause unnamed)
// as focused review, and a fresh same-demand retest of a declared subset of
// the open groups mirrors the attempt flow — original verdict and recovery
// credit side by side, never merged. Story 4: Completed now reads from an
// EARNED, VERSION-SCOPED award (every required item done + the required test
// passed or fully recovered — awarded exactly once, never revoked); earned
// awards list under the roadmap line, and the study-version switcher moves
// the studied release only through an informed flow that first discloses the
// changed required work and never erases prior awards.
export function AssessmentStage({ study, busy, onBusy, onFailure }: Props) {
  const [state, setState] = useState<AssessmentResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [retestChoices, setRetestChoices] = useState<Record<number, string>>({});
  // Retest target declaration: open targets default to SELECTED; the learner
  // may narrow the subset. Stale entries are ignored once the open set moves.
  const [targetSelection, setTargetSelection] = useState<Record<number, boolean>>({});
  // Story 4 — the informed switch flow: a chosen target version, the served
  // changed-work disclosure, and the confirmation that moves the studied
  // release only after the learner has seen the exact diff.
  const [switchTarget, setSwitchTarget] = useState("");
  const [disclosure, setDisclosure] = useState<SwitchDisclosureResponse | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  const retestResultHeading = useRef<HTMLHeadingElement>(null);
  const switchHeading = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef(onFailure);
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  // The submit command envelope per attempt/retest: a lost response replays
  // the SAME command (the receipt machinery returns the identical result); a
  // new attempt always runs under a fresh start command.
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
    // Eventually-consistent serving: the panel re-reads on a light always-on
    // cadence (2s while no course state exists, 3s once settled). The
    // assessment is a server-derived view of the studied release — an
    // API-driven regeneration or switch must reach this panel without a
    // manual reload, and no other stage owns that signal. The poll never
    // focuses anything; it only refreshes state.
    const timer = setInterval(read, empty ? 2000 : 3000);
    return () => { live = false; clearInterval(timer); };
  }, [study.rootId, study.revision, empty]);
  // study.revision re-reads: a re-confirmed plan (regeneration) advances the
  // batch revision — the assessment must re-resolve the studied release then,
  // even when the stage was not remounted (e.g. an API-driven regeneration
  // that never unmounts this panel). Without it a stale graded view (an
  // earlier Completed award) would survive until a manual reload.
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
  // Story 2 — the retest flow mirrors the attempt flow: a fresh start command
  // (the server returns the pinned open retest while one is open), a stable
  // submit envelope per retest, and focus choreography onto the recovery
  // heading after each step.
  const startRetestFlow = (rootAttemptId: string, targetIndexes: number[]) => act(async () => {
    await api<StartedRetest>(`studies/${study.rootId}/assessment/retest`, json({ ...command(study.revision), attemptId: rootAttemptId, targetIndexes }));
    await refresh(); setRetestChoices({});
    setNotice(`Targeted retest open — ${targetIndexes.length} objective group${targetIndexes.length === 1 ? "" : "s"}, fresh questions at the same demand. It submits exactly once.`);
    requestAnimationFrame(() => recoveryHeading.current?.focus());
  });
  const submitRetestFlow = (retestId: string) => act(async () => {
    const answers = Object.entries(retestChoices).map(([position, choiceId]) => ({ position: Number(position), choiceId }));
    const result = await api<SubmittedRetest>(`studies/${study.rootId}/assessment/retest/${retestId}/submit`, json({ ...intent(`retest-submit-${retestId}`), retestId, answers }));
    await refresh(); setRetestChoices({});
    const cleared = result.groups.filter(group => group.cleared).length;
    setNotice(`Retest graded — ${cleared} of ${result.groups.length} reassessed group${result.groups.length === 1 ? "" : "s"} cleared at the original pass mark.`);
    requestAnimationFrame(() => retestResultHeading.current?.focus());
  });
  // Story 4 — the informed switch flow: the changed-work disclosure is a
  // read-only GET shown BEFORE any move; the confirmed switch carries the
  // exact acknowledged diff (a stale or partial acknowledgment is denied
  // server-side), a stable per-target command envelope replays idempotently,
  // and no award is ever erased.
  const showSwitchDisclosure = () => act(async () => {
    const shown = await api<SwitchDisclosureResponse>(`studies/${study.rootId}/assessment/switch?course=${encodeURIComponent(switchTarget)}`);
    setDisclosure(shown);
    setNotice("Changed required work shown below — confirm to switch, or cancel to stay.");
    requestAnimationFrame(() => switchHeading.current?.focus());
  });
  // The switch-confirm envelope is PINNED per target release AND revision:
  // a lost response replays the SAME command (the receipt machinery returns
  // the identical result) instead of minting a fresh key that would CONFLICT
  // against a switch that actually committed — the component's universal
  // retry pattern.
  const switchEnvelope = (courseId: string, revision: number) => {
    const key = `switch:${courseId}:${revision}`;
    let value = keys.current.get(key);
    if (!value) { value = command(revision); keys.current.set(key, value); }
    return value;
  };
  const confirmSwitch = () => {
    if (!disclosure) return;
    act(async () => {
      const acknowledged = {
        addedRequiredItemIds: disclosure.addedRequiredItems.map(item => item.id),
        removedRequiredItemIds: disclosure.removedRequiredItems.map(item => item.id),
        requiredTestChanged: disclosure.requiredTestChanged,
      };
      // The confirm command carries the DISCLOSURE's server-fresh revision:
      // an API-driven regeneration can advance the batch revision without the
      // study panel ever re-reading (its refresh signal rides course readiness
      // it already saw), and a stale expectedRevision would deny a switch the
      // learner just reviewed — the disclosure IS the fresh server truth.
      await api<SwitchedCourseVersion>(`studies/${study.rootId}/assessment/switch`, json({ ...switchEnvelope(disclosure.to.courseId, disclosure.revision), courseId: disclosure.to.courseId, acknowledged }));
      await refresh(); setDisclosure(null); setSwitchTarget("");
      setNotice(`Now studying version ${disclosure.to.version}. Prior awards and attempts stay listed.`);
      requestAnimationFrame(() => switchHeading.current?.focus());
    });
  };
  if (!state || state.state === "none") return null;
  const test = state.test;
  const active = state.state === "active" && state.attempt && !("gradedAt" in state.attempt) ? state.attempt : null;
  const graded = state.state === "graded" && state.attempt && "gradedAt" in state.attempt ? state.attempt : null;
  const answered = active ? active.items.filter(item => choices[item.position]).length : 0;
  // Story 2: group the graded items per objective as focused review — failed
  // groups read "Needs practice" (observed difficulty, cause unnamed, D2);
  // passed groups read "Passed — preserved" and are never re-tested. Grouping
  // keys on objectiveIndex (the ledger/clearing/retest key) — objective TEXT
  // is display only and may legally repeat across distinct groups.
  const gradedGroups: Array<{ objectiveIndex: number; objective: string; earned: number; total: number; failed: boolean; items: GradedItemView[] }> = [];
  if (graded) {
    for (const item of graded.items) {
      let group = gradedGroups.find(candidate => candidate.objectiveIndex === item.objectiveIndex);
      if (!group) { group = { objectiveIndex: item.objectiveIndex, objective: item.objective, earned: 0, total: 0, failed: false, items: [] }; gradedGroups.push(group); }
      group.total += item.points;
      group.earned += item.earned;
      group.items.push(item);
    }
    for (const group of gradedGroups) group.failed = group.earned * 100 < graded.passMarkPercent * group.total;
  }
  const recovery = state.recovery;
  const recoveryOpen = recovery ? recovery.targets.filter(target => target.status === "open") : [];
  const recoveryLive = !!(recovery && graded && recovery.rootAttemptId === graded.attemptId);
  const activeRetest = recovery?.retest && !("gradedAt" in recovery.retest) ? recovery.retest : null;
  const gradedRetest = recovery?.retest && "gradedAt" in recovery.retest ? recovery.retest : null;
  const selectedTargets = recoveryOpen.filter(target => targetSelection[target.objectiveIndex] !== false);
  const retestAnswered = activeRetest ? activeRetest.items.filter(item => retestChoices[item.position]).length : 0;
  // Story 3: the snapshot's declared scale renders every point amount, and an
  // item's disclosed partial-credit rubric (if its snapshot carries one — the
  // served root test never does) names each credited choice's exact credit
  // beside that choice. The rubric's credits map never contains the correct
  // answer, so the hints disclose credit without disclosing the key.
  const scale = test?.pointsScale ?? 1;
  const rubricOf = (position: number) => test?.items.find(entry => entry.position === position)?.partialCredit ?? null;
  return <section className="panel"><p className="eyebrow">REQUIRED TEST · SCORED ATTEMPT TRACER</p><h3 ref={heading} tabIndex={-1}>Assessment &amp; progress</h3>
    <output>{notice}</output>
    <p><strong>Roadmap: {nodeCopy[state.node]}.</strong> <span className="fine">Completed appears only from an earned, version-scoped award — every required course item done and the required test passed or fully recovered. Awards are recorded once and never revoked by later results, edits or review.</span></p>
    {state.awards.length > 0 && <div className="tracker-row">
      <p><strong>Completion awards</strong> <span className="fine">· version-scoped, listed, never overwritten</span></p>
      <ul>{state.awards.map(award => <li key={award.awardId} className="fine">
        {award.kind === "mini-course"
          ? `Mini-course version ${award.courseVersion} — completed ${new Date(award.awardedAt).toLocaleString()}`
          : `Parent path (${award.manifest?.children.filter(child => child.required).length ?? 0} required children) — completed ${new Date(award.awardedAt).toLocaleString()}`}
      </li>)}</ul>
    </div>}
    {test && <div className="tracker-row">
      <p><strong>{test.title}</strong> <span className="fine">· {test.itemCount} items · {test.itemPoints.map(points => displayPointsOf(points, test.pointsScale)).join(" + ")} = {displayPointsOf(test.totalPoints, test.pointsScale)} points</span></p>
      <p><strong>Pass mark: {test.passMarkPercent}%</strong> — shown before you start. The unrounded earned-points comparison decides; the display never rounds a Not passed into looking like a pass.</p>
      {test.passMarkOverride.source === "instructor" && <p className="fine">Pass-mark override: instructor-set {test.passMarkOverride.value}%, carried on this attempt&apos;s at-start snapshot (recorded {new Date(test.passMarkOverride.recordedAt).toLocaleString()}) — later policy changes apply only to new attempts.</p>}
      <p className="fine"><strong>Scoring criteria:</strong> {test.answerRule} {test.rubric} Source: manually authored synthetic fixture — no live AI, no generated questions.</p>
      {test.items.filter(entry => entry.partialCredit).map(entry => <p className="fine" key={entry.position}><strong>Item {entry.position} partial-credit rubric ({displayPointsOf(entry.points, test.pointsScale)} points):</strong> {entry.partialCredit!.disclosure}</p>)}
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
          <legend>Item {item.position} of {active.items.length} · {displayPointsOf(item.points, scale)} points · objective: {item.objective}</legend>
          <p>{item.prompt}</p>
          {item.choices.map(option => <div className="answer-row" key={option.id}>
            <input type="radio" id={`test-choice-${item.position}-${option.id}`} name={`test-choice-${item.position}`} value={option.id} checked={choices[item.position] === option.id} onChange={() => setChoices(previous => ({ ...previous, [item.position]: option.id }))} />
            <label htmlFor={`test-choice-${item.position}-${option.id}`}>{option.text}{rubricOf(item.position)?.credits[option.id] !== undefined ? <span className="fine"> — earns {displayPointsOf(rubricOf(item.position)!.credits[option.id]!, scale)} of {displayPointsOf(item.points, scale)} points if chosen</span> : null}</label>
          </div>)}
        </fieldset>)}
        <div className="actions"><button type="submit" disabled={busy || answered < active.items.length}>Submit test ({answered}/{active.items.length} answered)</button></div>
      </form>
      <p className="fine">The attempt submits exactly once — choose an answer for every item first. An unanswered item would score zero{test && test.items.some(entry => entry.partialCredit) ? "; on an item with a disclosed partial-credit rubric, a non-correct choice earns only its declared credit" : ""}.</p>
    </>}
    {graded && <>
      <h4 ref={resultHeading} tabIndex={-1}>Result</h4>
      <div className="notice"><p><strong>{graded.verdict}</strong> — {displayPointsOf(graded.earnedPoints, graded.pointsScale)}/{displayPointsOf(graded.totalPoints, graded.pointsScale)} points. The unrounded comparison decided this; one decimal is shown only when it cannot contradict the verdict.</p></div>
      {graded.gradeKind === "provisional" && <p className="fine">Provisional — pending instructor confirmation. A provisional grade cannot award completion.</p>}
      <p className="fine">Attempt {graded.attemptId.slice(0, 8)}… · course version {graded.courseVersion} · graded {new Date(graded.gradedAt).toLocaleString()} · started {new Date(graded.startedAt).toLocaleString()}.</p>
      <h4>Focused review</h4>
      <p className="fine">Items grouped per objective. “Needs practice” names observed difficulty only — it does not claim a cause. Passed groups are preserved and never re-tested.</p>
      {gradedGroups.map(group => <div className="tracker-row" key={group.objectiveIndex}>
        <p><strong>{group.failed ? "Needs practice" : "Passed — preserved"}</strong> · {group.objective} · {displayPointsOf(group.earned, graded.pointsScale)}/{displayPointsOf(group.total, graded.pointsScale)} on the original attempt{group.failed ? "" : " — never re-tested"}</p>
        {group.items.map(item => <fieldset key={item.position}>
          <legend>Item {item.position} · {item.earned === item.points ? `correct · ${displayPointsOf(item.points, graded.pointsScale)} points` : item.earned > 0 ? `partly correct · ${displayPointsOf(item.earned, graded.pointsScale)} of ${displayPointsOf(item.points, graded.pointsScale)} points` : item.chosenChoiceId === null ? "unanswered · 0 points" : "not correct · 0 points"}</legend>
          <p>{item.prompt}</p>
          <p><strong>Correct answer:</strong> {item.choices.find(choice => choice.id === item.correctChoiceId)?.text ?? item.correctChoiceId}{item.chosenChoiceId !== null && item.chosenChoiceId !== item.correctChoiceId && <> — your answer: {item.choices.find(choice => choice.id === item.chosenChoiceId)?.text ?? item.chosenChoiceId}</>}</p>
          <p className="fine">Objective: {item.objective} · {displayPointsOf(item.points, graded.pointsScale)} points.</p>
        </fieldset>)}
      </div>)}
      <div className="actions"><button disabled={busy} onClick={() => { void start(); }}>Start a new attempt</button></div>
      <p className="fine">No pedagogical attempt limit — a fresh attempt is always offered, never forced. This tracer has no gap guidance; that belongs to a later entry.</p>
    </>}
    {/* The recovery panel mounts whenever a chain exists in any served state —
        the component's `none` early return above already excludes the honest
        no-course state, so an open retest stays reachable even while a new
        ordinary attempt is open or the test is re-offered. */}
    {recovery && <div className="tracker-row">
      <h4 ref={recoveryHeading} tabIndex={-1}>Recovery</h4>
      {graded && !recoveryLive && <p className="fine">This chain belongs to an earlier failed attempt and stays listed and readable here.</p>}
      <p><strong>Failed-test requirement: {recovery.requirementSatisfied ? "satisfied" : `open — ${recoveryOpen.length} target group${recoveryOpen.length === 1 ? "" : "s"} uncleared`}.</strong> <span className="fine">Satisfied only when every ledgered group independently clears a fresh same-demand retest at the original pass mark; no untested group is inferred passed.</span></p>
      <ul>{recovery.targets.map(target => <li key={target.objectiveIndex} className="fine">
        {target.objective} — initial {displayPointsOf(target.initialEarned, target.pointsScale)}/{displayPointsOf(target.initialTotal, target.pointsScale)} ({target.initialDisplayPercent}) · {target.status === "cleared" ? `cleared ${target.clearedAt ? new Date(target.clearedAt).toLocaleString() : ""}` : "open"}
      </li>)}</ul>
      <p className="fine">Recovery credit lists beside the original result above — never merged, never averaged into a new score. The original row never changes.</p>
      {activeRetest && <>
        <p><strong>Retest open</strong> — {activeRetest.items.length} fresh item{activeRetest.items.length === 1 ? "" : "s"} for {activeRetest.targetIndexes.length} group{activeRetest.targetIndexes.length === 1 ? "" : "s"}, {displayPointsOf(activeRetest.items.reduce((sum, item) => sum + item.points, 0), activeRetest.pointsScale)} points. The original pass mark{recoveryLive && graded ? ` (${graded.passMarkPercent}%)` : ""}, answer rule and rubric apply; pinned to course version {activeRetest.courseVersion}.</p>
        <form onSubmit={event => { event.preventDefault(); void submitRetestFlow(activeRetest.retestId); }}>
          {activeRetest.items.map(item => <fieldset key={item.position} disabled={busy}>
            <legend>Retest item {item.position} of {activeRetest.items.length} · {displayPointsOf(item.points, activeRetest.pointsScale)} points · objective: {item.objective}</legend>
            <p>{item.prompt}</p>
            {item.choices.map(option => <div className="answer-row" key={option.id}>
              <input type="radio" id={`retest-choice-${item.position}-${option.id}`} name={`retest-choice-${item.position}`} value={option.id} checked={retestChoices[item.position] === option.id} onChange={() => setRetestChoices(previous => ({ ...previous, [item.position]: option.id }))} />
              <label htmlFor={`retest-choice-${item.position}-${option.id}`}>{option.text}</label>
            </div>)}
          </fieldset>)}
          <div className="actions"><button type="submit" disabled={busy || retestAnswered < activeRetest.items.length}>Submit retest ({retestAnswered}/{activeRetest.items.length} answered)</button></div>
        </form>
        <p className="fine">The retest submits exactly once. A group clears only when it independently reaches the original pass mark by the unrounded comparison.</p>
      </>}
      {gradedRetest && <>
        <h4 ref={retestResultHeading} tabIndex={-1}>Retest result</h4>
        <div className="notice"><p>Retest {gradedRetest.retestId.slice(0, 8)}… · {gradedRetest.groups.filter(group => group.cleared).length} of {gradedRetest.groups.length} reassessed group{gradedRetest.groups.length === 1 ? "" : "s"} cleared.</p></div>
        <ul>{gradedRetest.groups.map(group => <li key={group.objectiveIndex} className="fine">
          {group.objective} — {displayPointsOf(group.earned, group.pointsScale)}/{displayPointsOf(group.total, group.pointsScale)} ({group.displayPercent}) · {group.cleared ? "cleared" : "still open — the requirement stays unsatisfied"}
        </li>)}</ul>
        {gradedRetest.items.map(item => <fieldset key={item.position}>
          <legend>Retest item {item.position} · {item.earned === item.points ? `correct · ${displayPointsOf(item.points, gradedRetest.pointsScale)} points` : item.earned > 0 ? `partly correct · ${displayPointsOf(item.earned, gradedRetest.pointsScale)} of ${displayPointsOf(item.points, gradedRetest.pointsScale)} points` : item.chosenChoiceId === null ? "unanswered · 0 points" : "not correct · 0 points"}</legend>
          <p>{item.prompt}</p>
          <p><strong>Correct answer:</strong> {item.choices.find(choice => choice.id === item.correctChoiceId)?.text ?? item.correctChoiceId}{item.chosenChoiceId !== null && item.chosenChoiceId !== item.correctChoiceId && <> — your answer: {item.choices.find(choice => choice.id === item.chosenChoiceId)?.text ?? item.chosenChoiceId}</>}</p>
          <p className="fine">Objective: {item.objective} · {displayPointsOf(item.points, gradedRetest.pointsScale)} points.</p>
        </fieldset>)}
      </>}
      {!activeRetest && recoveryOpen.length > 0 && <>
        <p>Declare the open group{recoveryOpen.length === 1 ? "" : "s"} this retest covers — fresh questions mirroring the original per-group points exactly:</p>
        {recoveryOpen.map(target => <div className="answer-row" key={target.objectiveIndex}>
          <input type="checkbox" id={`retest-target-${target.objectiveIndex}`} checked={targetSelection[target.objectiveIndex] !== false} onChange={() => setTargetSelection(previous => ({ ...previous, [target.objectiveIndex]: previous[target.objectiveIndex] === false }))} disabled={busy} />
          <label htmlFor={`retest-target-${target.objectiveIndex}`}>{target.objective} — initial {displayPointsOf(target.initialEarned, target.pointsScale)}/{displayPointsOf(target.initialTotal, target.pointsScale)} ({target.initialDisplayPercent})</label>
        </div>)}
        <div className="actions"><button disabled={busy || selectedTargets.length === 0} onClick={() => { void startRetestFlow(recovery.rootAttemptId, selectedTargets.map(target => target.objectiveIndex)); }}>Start targeted retest ({selectedTargets.length} of {recoveryOpen.length} open group{recoveryOpen.length === 1 ? "" : "s"})</button></div>
        <p className="fine">Available now: {displayPointsOf(selectedTargets.reduce((sum, target) => sum + target.initialTotal, 0), recoveryOpen[0]?.pointsScale ?? scale)} points across {selectedTargets.length} group{selectedTargets.length === 1 ? "" : "s"}; a group clears only at the original pass mark. Passed groups are never re-tested; there is no time limit.</p>
      </>}
      {recovery.retests.length > 0 && <div>
        <p><strong>Retest history</strong> <span className="fine">· listed, never overwritten</span></p>
        <ul>{recovery.retests.map(retest => <li key={retest.retestId} className="fine">
          {new Date(retest.startedAt).toLocaleString()} · groups {retest.targetIndexes.join(", ")} · {retest.status === "active" ? "open — not yet submitted" : retest.groups ? retest.groups.map(group => `${displayPointsOf(group.earned, group.pointsScale)}/${displayPointsOf(group.total, group.pointsScale)} ${group.cleared ? "cleared" : "not cleared"}`).join(" · ") : "graded"}
        </li>)}</ul>
      </div>}
    </div>}
    {state.attempts.length > 0 && <div className="tracker-row">
      <p><strong>Attempt history</strong> <span className="fine">· listed, never overwritten</span></p>
      <ul>{state.attempts.map(attempt => <li key={attempt.attemptId} className="fine">
        {new Date(attempt.startedAt).toLocaleString()} · course version {attempt.courseVersion} · {attempt.status === "active" ? "open — not yet submitted" : `${attempt.displayPercent} — ${attempt.passed ? "Pass" : "Not passed"} (${displayPointsOf(attempt.earnedPoints ?? 0, attempt.pointsScale)}/${displayPointsOf(attempt.totalPoints ?? 0, attempt.pointsScale)})`}
      </li>)}</ul>
    </div>}
    {state.versions.length > 1 && <div className="tracker-row">
      <h4 ref={switchHeading} tabIndex={-1}>Study version</h4>
      <p className="fine">You are studying version {state.version}. A newer or older release never moves you silently — switching is your explicit choice, and it never erases earned awards or listed attempts.</p>
      <div className="actions">
        <label htmlFor="switch-target">Switch to version</label>
        <select id="switch-target" value={switchTarget} onChange={event => { setSwitchTarget(event.target.value); setDisclosure(null); }} disabled={busy}>
          <option value="">Choose a version…</option>
          {state.versions.filter(version => version !== state.version).map(version => <option key={version} value={version}>{version}</option>)}
        </select>
        <button disabled={busy || !switchTarget} onClick={() => { void showSwitchDisclosure(); }}>Show what changes</button>
      </div>
      {disclosure && <div>
        <p><strong>Changed required work — version {disclosure.from.version ?? "none"} → version {disclosure.to.version}:</strong></p>
        {disclosure.requiredTestChanged
          ? <p className="fine">The required test changes on version {disclosure.to.version} (different objectives and questions).</p>
          : <p className="fine">The required test is unchanged between these versions.</p>}
        {disclosure.addedRequiredItems.length > 0 && <div>
          <p className="fine">New required work you would have to complete:</p>
          <ul>{disclosure.addedRequiredItems.map(item => <li key={item.id} className="fine">Added — {item.title}</li>)}</ul>
        </div>}
        {disclosure.removedRequiredItems.length > 0 && <div>
          <p className="fine">Required work that no longer counts on the target version:</p>
          <ul>{disclosure.removedRequiredItems.map(item => <li key={item.id} className="fine">Removed — {item.title}</li>)}</ul>
        </div>}
        {disclosure.addedRequiredItems.length === 0 && disclosure.removedRequiredItems.length === 0 && <p className="fine">No required reading items change between these versions.</p>}
        <div className="actions">
          <button disabled={busy} onClick={() => { void confirmSwitch(); }}>Confirm switch to version {disclosure.to.version}</button>
          <button className="quiet" disabled={busy} onClick={() => { setDisclosure(null); setNotice("Switch canceled — you stay on the studied version."); }}>Cancel</button>
        </div>
        <p className="fine">Confirming moves your studied version; your award for version {disclosure.from.version ?? "—"} stays earned and listed.</p>
      </div>}
    </div>}
  </section>;
}

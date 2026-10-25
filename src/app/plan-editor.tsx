"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { goals, planSchema, type Plan, type Receipt } from "../contracts/setup";
import type { Study } from "../modules/materials-setup/service";
import { api, command, json } from "./client";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void; onDirty: (value: boolean) => void; onSaved: (value: Study) => void; draft?: { plan: Plan; stamp: number } | null };
const initial: Plan = { topic: "", goal: "Understand a topic", clarification: "", outcomes: [], miniCourse: { title: "", lessons: [], practice: "", estimatedMinutes: 20 }, missingExplanations: "Coverage not assessed. No supplementary sources fetched." };
export function PlanEditor({ study, busy, onBusy, onFailure, onDirty, onSaved, draft }: Props) {
  const [plan, setPlan] = useState<Plan>(study.draft?.plan ?? initial);
  const [dirty, setDirty] = useState(!study.draft);
  // A draft that differs from the confirmation is an explicit "new changes need
  // confirmation" state: the confirmed revision stays authoritative for handoff.
  const [status, setStatus] = useState(
    study.confirmed && study.draft && study.draft.id !== study.confirmed.id
      ? "New changes need confirmation. The earlier confirmed revision stays authoritative for course-generation handoff until you confirm again."
      : "",
  );
  const [editing, setEditing] = useState(!study.confirmed || study.draft?.id !== study.confirmed.id);
  const saveIntent = useRef<{ body: string; key: ReturnType<typeof command> } | null>(null);
  const confirmIntent = useRef<ReturnType<typeof command> | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // AI assist (S6) loads an advisory draft as EDITABLE unsaved fields. The
  // stamp deduplicates repeated loads; saving and confirming stay Manual and
  // the AI never auto-confirms.
  const draftRef = useRef(draft);
  useEffect(() => {
    if (!draft || draftRef.current?.stamp === draft.stamp) return;
    draftRef.current = draft;
    setPlan(draft.plan);
    setDirty(true); onDirty(true); setEditing(true);
    setStatus("AI draft loaded as editable suggestions — review and change anything. Nothing is saved or confirmed until you save and confirm; the AI never confirms.");
  }, [draft, onDirty]);
  function change(value: Plan) { setPlan(value); setDirty(true); onDirty(true); setStatus("Unsaved changes — confirmation requires a saved revision."); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = planSchema.safeParse(plan);
    if (!parsed.success) { setStatus(parsed.error.issues.map(issue => issue.message).join(" ")); form.current?.querySelector<HTMLElement>(`[name="${String(parsed.error.issues[0].path[0])}"]`)?.focus(); return; }
    onBusy(true);
    try {
      const body = JSON.stringify({ plan: parsed.data, selectionId: study.selection?.id, extractionId: study.extractionId });
      if (saveIntent.current?.body !== body) saveIntent.current = { body, key: command(study.revision) };
      const result = await api<Receipt>(`studies/${study.rootId}/plan`, json({ ...saveIntent.current.key, plan: parsed.data, extractionId: study.extractionId, selectionId: study.selection?.id }));
      const latest = await api<Study>(`studies/${study.rootId}`); onSaved(latest);
      confirmIntent.current = null;
      if (!latest.draft || latest.draft.id !== result.planRevisionId) {
        setDirty(true); onDirty(true); saveIntent.current = null;
        setStatus("Another client saved a newer draft. Your edits are retained and need saving again before confirmation."); return;
      }
      setPlan(latest.draft.plan); setDirty(false); onDirty(false);
      setStatus(`Saved Manual draft · revision ${result.revision}. Review before confirming.`);
    } catch (error) { onFailure(error); } finally { onBusy(false); }
  }
  async function confirm() {
    onBusy(true);
    try {
      confirmIntent.current ??= command(study.revision);
      await api(`studies/${study.rootId}/confirmation`, json({ ...confirmIntent.current, planRevisionId: study.draft?.id }));
      onSaved(await api<Study>(`studies/${study.rootId}`)); setEditing(false); setStatus("Exact Manual plan confirmed. Handoff pinned to this exact revision — plan ready for course generation; no generation job exists.");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) { onFailure(error); } finally { onBusy(false); }
  }
  async function reload() {
    onBusy(true);
    try {
      const latest = await api<Study>(`studies/${study.rootId}`); onSaved(latest);
      // Deliberately retain current in-memory edits for explicit reapplication.
      setDirty(true); onDirty(true); setEditing(true);
      saveIntent.current = null; confirmIntent.current = null;
      setStatus(`Latest saved revision ${latest.revision} loaded. Your unsaved edits are retained; review and save to reapply them.`);
    } catch (error) { onFailure(error); } finally { onBusy(false); }
  }
  return <section className="panel"><p className="eyebrow">MANUAL PLAN · AI SUGGESTIONS NEVER AUTO-CONFIRM</p><h2 ref={heading} tabIndex={-1}>{editing ? "02–03 · Shape your plan" : "Plan confirmed — course not generated"}</h2><output>{status}</output>
    {!study.selection && <output>Sources changed or are not acknowledged. This plan needs updated sources and new confirmation before it can be saved or handed off. Inspect previews and acknowledge the current source selection; retained edits are not saved.</output>}
    {editing ? <form ref={form} onSubmit={event => { void save(event); }}><fieldset disabled={busy || !study.selection} className="plan-fields"><legend className="fine">Review and save your Manual revision before confirmation</legend>
      <label htmlFor="topic">Topic</label><input id="topic" name="topic" required maxLength={160} value={plan.topic} onChange={event => change({ ...plan, topic: event.target.value })} />
      <label htmlFor="goal">Learning goal</label><select id="goal" name="goal" value={plan.goal} onChange={event => change({ ...plan, goal: event.target.value as Plan["goal"] })}>{goals.map(goal => <option key={goal}>{goal}</option>)}</select>
      {plan.goal === "Other" && <><label htmlFor="clarification">Short clarification for Other</label><input id="clarification" name="clarification" required maxLength={240} value={plan.clarification} onChange={event => change({ ...plan, clarification: event.target.value })} /></>}
      <label htmlFor="outcomes">Learning outcomes · one per line</label><textarea id="outcomes" name="outcomes" required value={plan.outcomes.join("\n")} onChange={event => change({ ...plan, outcomes: event.target.value.split("\n") })} />
      <label htmlFor="title">One mini-course title</label><input id="title" required maxLength={160} value={plan.miniCourse.title} onChange={event => change({ ...plan, miniCourse: { ...plan.miniCourse, title: event.target.value } })} />
      <label htmlFor="lessons">Lessons · one per line</label><textarea id="lessons" required value={plan.miniCourse.lessons.join("\n")} onChange={event => change({ ...plan, miniCourse: { ...plan.miniCourse, lessons: event.target.value.split("\n") } })} />
      <label htmlFor="practice">Practice activity</label><textarea id="practice" required maxLength={1000} value={plan.miniCourse.practice} onChange={event => change({ ...plan, miniCourse: { ...plan.miniCourse, practice: event.target.value } })} />
      <label htmlFor="minutes">Estimated effort · minutes, not a guarantee</label><input id="minutes" required type="number" min={1} max={600} value={plan.miniCourse.estimatedMinutes} onChange={event => change({ ...plan, miniCourse: { ...plan.miniCourse, estimatedMinutes: Number(event.target.value) } })} />
      <label htmlFor="missing">Source coverage / missing explanations · your flags for future supplementation, never fetched citations</label><textarea id="missing" required maxLength={1000} value={plan.missingExplanations} onChange={event => change({ ...plan, missingExplanations: event.target.value })} />
      <p className="fine">This revision pins the exact acknowledged source set above. Coverage and missing explanations are your own flags for a future supplementation stage; no sources are fetched and no factual verification is implied. Effort figures are estimates, not guarantees.</p>
      <div className="actions"><button disabled={busy}>Save Manual draft</button><button className="secondary" type="button" disabled={busy || dirty || !study.draft || study.draft.selectionId !== study.selection?.id} onClick={() => { void confirm(); }}>Confirm exact saved plan</button></div>
      <button className="quiet" type="button" disabled={busy} onClick={() => { void reload(); }}>Reload latest revision · keep my edits</button>
    </fieldset></form> : <><h3>{study.confirmed?.plan.miniCourse.title}</h3><p>{study.confirmed?.plan.topic} · {study.confirmed?.plan.goal}</p><ul>{study.confirmed?.plan.outcomes.map(outcome => <li key={outcome}>{outcome}</li>)}</ul><h3>Lessons</h3><ol>{study.confirmed?.plan.miniCourse.lessons.map(lesson => <li key={lesson}>{lesson}</li>)}</ol><p><strong>Practice:</strong> {study.confirmed?.plan.miniCourse.practice}</p><p>Estimated effort: {study.confirmed?.plan.miniCourse.estimatedMinutes} minutes (estimate)</p><p>Source coverage / missing explanations: {study.confirmed?.plan.missingExplanations}</p><h3>Confirmed sources</h3><ul>{study.confirmed?.sources.map(source => <li key={source.extractionId}>{source.filename} · extraction {source.extractionId}</li>)}</ul><p className="fine">These are the exact acknowledged source revisions the confirmation pinned. If a source is later deleted or replaced, the handoff is rejected until the plan is re-saved and re-confirmed; no automatic substitute is ever consumed.</p><p>Plan ready for course generation: the exact confirmed Manual revision <code>{study.confirmed?.id}</code> and the pinned sources above are what a future generator would receive.</p><button className="quiet" type="button" disabled aria-disabled="true">Generate course — unavailable in this release</button><p className="fine">Manual · exact immutable revision · no generation job, enrollment or completion award exists. Course generation and the optional starting check are unavailable in this tracer; the handoff is a read-only view of the confirmed revision.</p><button className="quiet" onClick={() => { setEditing(true); requestAnimationFrame(() => heading.current?.focus()); }}>Edit a new draft revision</button></>}
  </section>;
}
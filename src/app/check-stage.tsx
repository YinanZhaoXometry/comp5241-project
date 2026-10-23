"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import type { Assistance, CheckState, SubmittedItem } from "../contracts/diagnostic";
import type { Study } from "../modules/materials-setup/service";

type Props = { study: Study; busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void };
// U6 optional starting check. Equally visible Take/Skip from the confirmed
// plan; answers and rationales arrive only after that item's submission;
// skipped or left items stay Unknown; nothing here grants completion credit,
// a score, recovery or a scored-course attempt.
export function CheckStage({ study, busy, onBusy, onFailure }: Props) {
  const [state, setState] = useState<CheckState | null>(null);
  const [notice, setNotice] = useState("");
  const [choice, setChoice] = useState("");
  const [assisted, setAssisted] = useState(false);
  const failureRef = useRef(onFailure);
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  const keys = useRef(new Map<string, ReturnType<typeof command>>());
  const intent = (name: string) => {
    const key = `${name}:${study.revision}`;
    let value = keys.current.get(key);
    if (!value) { value = command(study.revision); keys.current.set(key, value); }
    return value;
  };
  const refresh = useCallback(async () => {
    const value = await api<CheckState>(`studies/${study.rootId}/check`);
    setState(value); setChoice(""); setAssisted(false);
    return value;
  }, [study.rootId]);
  useEffect(() => {
    let live = true;
    // The mount key includes the revision, so a new check revision remounts
    // with empty state; no synchronous reset is needed inside the effect.
    api<CheckState>(`studies/${study.rootId}/check`).then(value => { if (live) setState(value); }).catch(error => { if (live) failureRef.current(error); });
    return () => { live = false; };
  }, [study.rootId, study.revision]);
  async function act(work: () => Promise<void>) {
    onBusy(true); setNotice("");
    try { await work(); } catch (error) { onFailure(error); } finally { onBusy(false); }
  }
  const take = () => act(async () => { await api(`studies/${study.rootId}/check`, json(intent("take"))); await refresh(); setNotice("Synthetic check started · manually authored items · no live AI."); });
  const skip = () => act(async () => { await api(`studies/${study.rootId}/check/skip`, json(intent("skip"))); await refresh(); setNotice("Skipped for now — setup is complete without penalty."); });
  const submit = (position: number) => act(async () => {
    if (!choice) return;
    const body: { position: number; choiceId: string; assistance: Assistance } = { position, choiceId: choice, assistance: assisted ? "assisted" : "unaided" };
    const result = await api<SubmittedItem>(`studies/${study.rootId}/check/${state?.bundleId}/item`, json({ ...intent(`item-${position}`), ...body }));
    await refresh();
    setNotice(`Item ${position} recorded: ${result.outcome}. This is evidence with uncertainty, not a grade.`);
  });
  const skipItem = (position: number) => act(async () => {
    await api(`studies/${study.rootId}/check/${state?.bundleId}/item`, json({ ...intent(`item-skip-${position}`), position, assistance: assisted ? "assisted" : "unaided" }));
    await refresh();
    setNotice(`Item ${position} left as Unknown. No answer or rationale was revealed.`);
  });
  const finish = () => act(async () => {
    const result = await api<{ submitted: number; unknown: number }>(`studies/${study.rootId}/check/${state?.bundleId}/finish`, json(intent("finish")));
    await refresh();
    setNotice(`Check finished · ${result.submitted} submitted · ${result.unknown} Unknown. No completion credit was created.`);
  });
  const flag = (position: number) => act(async () => {
    await api(`studies/${study.rootId}/check/${state?.bundleId}/flag`, json({ ...intent(`flag-${position}`), position }));
    await refresh();
    setNotice(`Item ${position} flagged as unclear. The flag is recorded with the evidence; it changes no outcome.`);
  });
  if (!state || state.status === "no-confirmed-plan") return null;
  const open = state.items.find(item => !item.evidence);
  return <section className="panel"><p className="eyebrow">SYNTHETIC CHECK · MANUALLY AUTHORED · NO LIVE AI</p><h2 tabIndex={-1}>Optional starting check</h2><output>{notice}</output>
    {state.historical && <p className="fine">An earlier check belongs to the previously confirmed plan revision; its evidence stays historical and no longer accepts submissions.</p>}
    {state.status === "offered" && !state.skipRecorded && <><p>Four short questions linked to your confirmed plan outcomes and selected sources. Each submitted answer reveals its own explanation; anything you leave is recorded as Unknown.</p><div className="actions"><button disabled={busy} onClick={() => { void take(); }}>Take 3–5-question starting check</button><button className="secondary" disabled={busy} onClick={() => { void skip(); }}>Skip for now</button></div><p className="fine">Both choices finish setup equally. The check creates no completion credit, score, recovery or exemption either way.</p></>}
    {state.status === "unavailable" && <><p>The starting check is unavailable for this confirmed plan revision: the synthetic item set cannot be linked to its outcomes and sources. Nothing was generated and no items were invented.</p><div className="actions"><button className="secondary" disabled={busy} onClick={() => { void skip(); }}>Skip for now</button></div><p className="fine">Skipping finishes setup without penalty. Unavailable is not a pass, a failure or evidence of weakness.</p></>}
    {state.status === "offered" && state.skipRecorded && <p className="fine">Skipped for now — setup is complete without penalty. You can still start the optional synthetic check.</p>}
    {(state.status === "active" || state.status === "finished") && state.bundleId && <>
      <p>Item set pinned to the confirmed plan revision · source: manually authored synthetic fixture. {state.submittedCount} submitted · {state.unknownCount} Unknown.</p>
      {open && <form onSubmit={event => { event.preventDefault(); void submit(open.position); }}><fieldset disabled={busy}><legend>Item {open.position} of {state.items.length} · objective: {open.objective} · source: {open.sourceRef}</legend><p>{open.prompt}</p>{open.choices.map(option => <div className="answer-row" key={option.id}><input type="radio" id={`check-choice-${open.position}-${option.id}`} name={`check-choice-${open.position}`} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} /><label htmlFor={`check-choice-${open.position}-${option.id}`}>{option.text}</label></div>)}
        <fieldset><legend>Assistance</legend><div className="answer-row answer-compact"><input type="radio" id={`check-aid-no-${open.position}`} name={`check-aid-${open.position}`} checked={!assisted} onChange={() => setAssisted(false)} /><label htmlFor={`check-aid-no-${open.position}`}>Unaided</label></div><div className="answer-row answer-compact"><input type="radio" id={`check-aid-yes-${open.position}`} name={`check-aid-${open.position}`} checked={assisted} onChange={() => setAssisted(true)} /><label htmlFor={`check-aid-yes-${open.position}`}>Assisted</label></div></fieldset>
        <div className="actions"><button type="submit" disabled={busy || !choice}>Submit answer</button><button className="quiet" type="button" disabled={busy} onClick={() => { void skipItem(open.position); }}>Skip this item · stays Unknown</button><button className="quiet" type="button" disabled={busy} onClick={() => { void finish(); }}>Finish check · leave the rest Unknown</button></div>
      </fieldset></form>}
      {state.items.filter(item => item.evidence).map(item => <fieldset key={item.position}><legend>Item {item.position} · {item.evidence!.path === "item-skip" ? "left unanswered · Unknown" : `recorded ${item.evidence!.outcome}${item.evidence!.assistance === "assisted" ? " · assisted" : " · unaided"}${item.evidence!.unclear ? " · flagged unclear" : ""}`}</legend><p>{item.prompt}</p>{item.evidence!.path === "item-submit" && <><p><strong>Recorded outcome: {item.evidence!.outcome}</strong> — evidence with uncertainty, not a grade, score or completion credit.</p><p><strong>Objective:</strong> {item.objective} · <strong>Source:</strong> {item.sourceRef}</p><p><strong>Explanation:</strong> {item.evidence!.rationale}</p>{!item.evidence!.unclear && <button className="quiet" disabled={busy} onClick={() => { void flag(item.position); }}>Flag as unclear</button>}</>}{item.evidence!.path === "item-skip" && <p className="fine">Skipped before answering; the answer and explanation stay withheld and the objective remains Unknown.</p>}</fieldset>)}
      {state.status === "finished" && <><p><strong>Check finished.</strong> Unassessed objectives remain Unknown. The diagnostic never creates completion awards, scored-course attempts or recovery credit; self-report stays separate.</p><button className="quiet" disabled={busy} onClick={() => { void refresh().then(() => setNotice("Evidence stays recorded on its pinned revision. Return to the confirmed plan above.")); }}>Return to confirmed plan view</button></>}
    </>}
  </section>;
}

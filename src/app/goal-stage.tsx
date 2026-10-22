"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { goals } from "../contracts/setup";
import { savePreferencesSchema, timePreferences, type Goal, type Preferences, type TimePreference } from "../contracts/preferences";
import { errorCode } from "../platform/errors";
import { api, command } from "./client";

const detected = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
type Props = { busy: boolean; onBusy: (value: boolean) => void; onFailure: (error: unknown) => void; onDirty: (value: boolean) => void };

// S4 goal stage: server-saved goal/topic state plus optional preferences.
// The topic is Manual — no topic inference exists in this release (S6 is blocked).
export function GoalStage({ busy, onBusy, onFailure, onDirty }: Props) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [topic, setTopic] = useState("");
  const [clarification, setClarification] = useState("");
  const [background, setBackground] = useState("");
  const [timePreference, setTimePreference] = useState<TimePreference | null>(null);
  const [timezone, setTimezone] = useState(detected);
  const [status, setStatus] = useState("Checking for saved setup…");
  const [conflict, setConflict] = useState(false);
  const revision = useRef(0);
  const lastSaved = useRef<Preferences | null>(null);
  const saveIntent = useRef<{ body: string; key: ReturnType<typeof command> } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The load runs once per mount: the parent passes a fresh onFailure identity
  // every render, and re-running this fetch on each poll would clobber the
  // explicit "Saved · revision N" status and the learner's in-progress state.
  const onFailureRef = useRef(onFailure);
  useEffect(() => { onFailureRef.current = onFailure; });
  useEffect(() => {
    let active = true;
    void api<Preferences>("preferences").then(value => {
      if (!active) return;
      revision.current = value.revision; lastSaved.current = value;
      setGoal(value.goal); setTopic(value.topic); setClarification(value.clarification); setBackground(value.background);
      setTimePreference(value.timePreference); setTimezone(value.timezone || detected);
      setStatus(value.revision > 0 || value.topic || value.goal || value.background || value.timezone ? `Resumed saved setup · revision ${value.revision}.` : "Nothing saved yet. Choosing a goal is enough to start; everything here is optional except Other's short clarification.");
    }).catch(error => { if (active) onFailureRef.current(error); });
    return () => { active = false; };
  }, []);
  function markEdit() { onDirty(true); setConflict(false); setStatus("Unsaved changes — not saved yet."); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = { stage: "goal" as const, goal, topic, clarification, background, timePreference, timezone };
    const body = JSON.stringify(content);
    // One stable command key per unchanged intent so a lost response cannot
    // create a second committed save.
    if (saveIntent.current?.body !== body) saveIntent.current = { body, key: command(revision.current) };
    const parsed = savePreferencesSchema.safeParse({ ...saveIntent.current.key, ...content });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setConflict(false); setStatus(issue.message);
      form.current?.querySelector<HTMLElement>(`[name="${String(issue.path[0])}"]`)?.focus();
      return;
    }
    onBusy(true);
    try {
      const saved = await api<Preferences>("preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const previous = lastSaved.current;
      revision.current = saved.revision; lastSaved.current = saved; saveIntent.current = null;
      setGoal(saved.goal); setTopic(saved.topic); setClarification(saved.clarification); setBackground(saved.background);
      setTimePreference(saved.timePreference); setTimezone(saved.timezone);
      onDirty(false); setConflict(false);
      const relevant = previous && (previous.goal !== saved.goal || previous.topic !== saved.topic || previous.clarification !== saved.clarification);
      setStatus(`Saved · revision ${saved.revision}.${relevant ? " Goal/topic changed — an already confirmed plan needs re-confirmation against this revision; older history is kept." : ""}`);
    } catch (error) {
      if (errorCode(error) === "CONFLICT") { setConflict(true); setStatus("The saved setup changed in another tab or session. Reload the saved version — your in-progress edits are kept."); }
      else onFailure(error);
    } finally { onBusy(false); }
  }
  async function reload() {
    onBusy(true);
    try {
      const latest = await api<Preferences>("preferences");
      revision.current = latest.revision; lastSaved.current = latest; saveIntent.current = null; setConflict(false);
      // Deliberately retain current in-memory edits for explicit reapplication.
      onDirty(true);
      setStatus(`Latest saved revision ${latest.revision} loaded. Your unsaved edits are retained; review and save to reapply them.`);
    } catch (error) { onFailure(error); } finally { onBusy(false); }
  }
  return <section className="panel"><p className="eyebrow">MANUAL TOPIC · SAVED SERVER-SIDE</p><h2 ref={heading} tabIndex={-1}>02 · Topic & goal</h2><output>{status}</output>
    <form ref={form} onSubmit={event => { void save(event); }}><fieldset disabled={busy} className="plan-fields"><legend className="fine">Manual entry only — no AI topic inference exists in this release. Saved state resumes after back, refresh or sign-in.</legend>
      <label htmlFor="stage-topic">Topic (Manual)</label><input id="stage-topic" name="topic" maxLength={160} value={topic} onChange={event => { setTopic(event.target.value); markEdit(); }} />
      <label htmlFor="stage-goal">Goal</label><select id="stage-goal" name="goal" value={goal ?? ""} onChange={event => { setGoal((event.target.value || null) as Goal | null); markEdit(); }}><option value="">Not set</option>{goals.map(value => <option key={value}>{value}</option>)}</select>
      {goal === "Other" && <><label htmlFor="stage-clarification">Short clarification · Other goal</label><input id="stage-clarification" name="clarification" maxLength={240} value={clarification} onChange={event => { setClarification(event.target.value); markEdit(); }} /></>}
      <label htmlFor="stage-background">Background (optional, short)</label><textarea id="stage-background" name="background" maxLength={400} value={background} onChange={event => { setBackground(event.target.value); markEdit(); }} />
      <label htmlFor="stage-time">Time preference (optional)</label><select id="stage-time" name="timePreference" value={timePreference ?? ""} onChange={event => { setTimePreference((event.target.value || null) as TimePreference | null); markEdit(); }}><option value="">Not set</option>{timePreferences.map(value => <option key={value}>{value}</option>)}</select>
      <label htmlFor="stage-timezone">Timezone (IANA)</label><input id="stage-timezone" name="timezone" maxLength={64} value={timezone} onChange={event => { setTimezone(event.target.value); markEdit(); }} aria-describedby="stage-timezone-hint" />
      <p id="stage-timezone-hint" className="fine">Detected {detected || "no zone"} — correct it if wrong. Stored for later scheduling; nothing is scheduled in this release.</p>
      <div className="actions"><button disabled={busy}>Save topic & goal</button>{conflict && <button className="quiet" type="button" disabled={busy} onClick={() => { void reload(); }}>Reload saved · keep my edits</button>}</div>
    </fieldset></form>
    <p className="fine">Saving reports an exact server revision. Unacknowledged edits are never reported saved. Changing goal or topic later makes older plan confirmations stale without erasing history.</p>
  </section>;
}

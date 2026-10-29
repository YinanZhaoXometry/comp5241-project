"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, command, json } from "./client";
import { PlanEditor } from "./plan-editor";
import { FilePicker, Materials } from "./materials";
import { PrivacyPanel } from "./privacy-panel";
import { GoalStage } from "./goal-stage";
import { CheckStage } from "./check-stage";
import { CourseStage } from "./course-stage";
import { AssessmentStage } from "./assessment-stage";
import { ExportPanel } from "./export-panel";
import { DangerZone } from "./danger-zone";
import { AiAssist } from "./ai-assist";
import type { Plan } from "../contracts/setup";
import { errorCode, messages } from "../platform/errors";
import type { Study } from "../modules/materials-setup/service";
import type { Receipt } from "../contracts/setup";

type Session = { user: { id: string; name: string }; needsRefresh: boolean };
type Entry = { rootId: string; filename: string; revision: number; state: string; confirmed: boolean; cleanupState: string; courseGenerated: boolean };

export function StudyApp({ prefillEmail, prefillPassword }: Readonly<{ prefillEmail?: string; prefillPassword?: string }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [study, setStudy] = useState<Study | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadAbort = useRef<AbortController | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [viewGeneration, setViewGeneration] = useState(0);
  const [aiTopic, setAiTopic] = useState<{ value: string; stamp: number } | null>(null);
  const [aiDraft, setAiDraft] = useState<{ plan: Plan; stamp: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const actionKeys = useRef(new Map<string, ReturnType<typeof command>>());
  const generation = useRef(0);
  const clear = useCallback(() => {
    generation.current += 1;
    uploadAbort.current?.abort(); uploadAbort.current = null; setUploading(false);
    setViewGeneration(generation.current); setBusy(false);
    setSession(null); setEntries([]); setStudy(null); setDirty(false); setReceipt(null); actionKeys.current.clear(); setAiTopic(null); setAiDraft(null);
  }, []);
  const failure = useCallback((error: unknown) => {
    const code = errorCode(error);
    if (code === "UNAUTHENTICATED") clear();
    if (code === "FORBIDDEN_OR_NOT_FOUND") { setStudy(null); setDirty(false); }
    setNotice(messages[code]);
  }, [clear]);
  const load = useCallback(async () => {
    const stamp = generation.current;
    try {
      const current = await api<Session | null>("auth/get-session");
      if (stamp !== generation.current) return;
      if (!current) { clear(); setNotice("Sign in again to continue."); return; }
      if (current.needsRefresh) await api("auth/get-session", json({}));
      const library = await api<Entry[]>("studies");
      if (stamp !== generation.current) return;
      setSession(previous => {
        if (previous && previous.user.id !== current.user.id) { queueMicrotask(clear); return null; }
        return current;
      });
      setEntries(library);
      setStudy(previous => previous && library.some(entry => entry.rootId === previous.rootId && entry.state !== "deleted") ? previous : null);
    } catch (error) { if (stamp === generation.current) failure(error); }
    finally { setReady(true); }
  }, [clear, failure]);
  useEffect(() => {
    const initialLoad = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { void load(); }, 2000);
    const channel = new BroadcastChannel("private-study-session");
    channel.onmessage = () => { clear(); void load(); };
    const visible = () => { if (document.visibilityState === "hidden") clear(); else void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(initialLoad); clearInterval(timer); channel.close(); document.removeEventListener("visibilitychange", visible); };
  }, [load, clear]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const rootId = study?.rootId;
  // Poll only while at least one slot has unfinished extraction work; previews
  // arrive per file, so an idle study must not re-read its extracted text.
  const workPending = !!study && study.slots.some(slot => ["queued", "extracting", "retryable-failed"].includes(slot.state));
  useEffect(() => {
    if (!rootId || !workPending) return;
    const timer = setInterval(() => {
      const stamp = generation.current;
      void api<Study>(`studies/${rootId}`).then(value => { if (stamp === generation.current) setStudy(value); }).catch(error => { if (stamp === generation.current) failure(error); });
    }, 1000);
    return () => clearInterval(timer);
  }, [rootId, workPending, failure]);
  async function act(work: (current: () => boolean) => Promise<void>) {
    const stamp = generation.current; const current = () => stamp === generation.current;
    setBusy(true); setNotice("");
    try { await work(current); } catch (error) { if (current()) failure(error); } finally { if (current()) setBusy(false); }
  }
  function moveFocus() { requestAnimationFrame(() => heading.current?.focus()); }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await act(async () => {
      await api("auth/sign-in/email", json({ email: form.get("email"), password: form.get("password") }));
      clear(); await load(); moveFocus();
    });
  }
  async function signOut() {
    clear();
    const channel = new BroadcastChannel("private-study-session"); channel.postMessage("clear"); channel.close();
    await act(async () => { await api("auth/sign-out", json({})); setNotice("Signed out. Private views cleared."); });
  }
  async function open(root: string) {
    if (dirty && !globalThis.confirm("Leave unsaved edits? Only saved work can be reopened.")) return;
    await act(async current => { const value = await api<Study>(`studies/${root}`); if (!current()) return; setStudy(value); setDirty(false); setReceipt(null); actionKeys.current.clear(); setAiTopic(null); setAiDraft(null); moveFocus(); });
  }
  async function upload(files: File[]) {
    const intent = `inputs:${study?.rootId ?? "new"}:${files.map(file => `${file.name}:${file.size}:${file.lastModified}`).join("|")}`;
    let key = actionKeys.current.get(intent); if (!key) { key = command(); actionKeys.current.set(intent, key); }
    const uploadKey = key;
    const abort = new AbortController(); uploadAbort.current = abort; setUploading(true);
    await act(async current => {
      const inputs = files.map((file, index) => ({ slotId: crypto.randomUUID(), filename: file.name, mime: file.type || (/\.md$/iu.test(file.name) ? "text/markdown" : /\.txt$/iu.test(file.name) ? "text/plain" : /\.pdf$/iu.test(file.name) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), byteLength: file.size, index }));
      // A stable slot ID follows this intent even after a lost response.
      for (const input of inputs) { const slotIntent = `${intent}:slot:${input.index}`; let slot = actionKeys.current.get(slotIntent); if (!slot) { slot = command(); actionKeys.current.set(slotIntent, slot); } input.slotId = slot.commandKey; }
      const body = { ...uploadKey, expectedRevision: study?.revision ?? 0, inputs: inputs.map(({ slotId, filename, mime, byteLength }) => ({ slotId, filename, mime, byteLength })) };
      const result = await api<Receipt>(study ? `batches/${study.rootId}/inputs` : "batches", json(body));
      for (const input of inputs) {
        if (!current()) return;
        const uploadIntent = `${intent}:upload:${input.index}`; let itemKey = actionKeys.current.get(uploadIntent); if (!itemKey) { itemKey = command(); actionKeys.current.set(uploadIntent, itemKey); }
        try { await api(`batches/${result.rootId}/slots/${input.slotId}`, { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/octet-stream", "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": itemKey.commandKey }, body: files[input.index] }); }
        catch (error) { if (current()) { const saved = await api<Study>(`studies/${result.rootId}`); if (current()) { setStudy(saved); setReceipt(null); } } throw error; }
      }
      const value = await api<Study>(`studies/${result.rootId}`); if (!current()) return;
      setStudy(value); setReceipt(null); await load(); if (current()) moveFocus();
    });
    if (uploadAbort.current === abort) { setUploading(false); uploadAbort.current = null; if (abort.signal.aborted) setNotice("Upload canceled. Committed originals remain saved; unfinished slots can be retried or removed."); }
  }
  return <>
    <a className="skip-link" href="#main">Skip to study workspace</a>
    <header className="topbar"><Link href="/" className="brand" prefetch={false}>Fieldnotes<span>PRIVATE STUDY</span></Link><span className="tag">Local · synthetic only</span>{session && <button className="quiet" onClick={() => { void signOut(); }}>Sign out</button>}</header>
    <main id="main" className="workspace">
      <aside className="sidebar"><p className="eyebrow">YOUR WORKSPACE</p><h2>Make room<br />for understanding.</h2><p>Read a source. Choose a direction. Shape a small, deliberate plan.</p><ol className="steps"><li>01 · Materials</li><li>02 · Topic & goal</li><li>03 · Manual plan</li></ol><p className="fine">AI runs locally and stays labeled. Generated courses are AI-generated · Unreviewed. No completion credit.</p></aside>
      <div className="content">
        <p className="eyebrow">COMP5241 / PRIVATE STUDY SETUP</p>
        <h1 ref={heading} tabIndex={-1}>{session ? study ? "From source to study plan" : "My study library" : "A private place to begin"}</h1>
        <p className="subtitle">A small, source-led learning journey. Your plan stays yours.</p>
        <div role="alert" className={notice ? "notice" : undefined}>{notice}</div>
        {!ready && <output>Checking your session…</output>}
        {ready && !session && <section className="panel signin"><h2>Sign in</h2><p>Use an operator-provisioned synthetic account. Public sign-up and self-promotion are unavailable.</p><form onSubmit={event => { void signIn(event); }}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} defaultValue={prefillEmail} /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required minLength={16} maxLength={128} defaultValue={prefillPassword} /><button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form><p className="fine">{prefillEmail ? "Email and password prefilled from the local synthetic learner account." : "Contact the local operator for account access or recovery."}</p></section>}
        {session && <>
          <p className="fine">Signed in as {session.user.name}</p>
          {uploading && <button className="quiet" onClick={() => uploadAbort.current?.abort()}>Cancel upload</button>}
          {receipt && <section className="panel"><h2>Deletion receipt</h2><output>{receipt}</output></section>}
          {!study && <section className="panel"><h2>Start with sources</h2><FilePicker busy={busy} onUpload={upload} /></section>}
          {study && <>
            <div className="section-heading"><h2>Your materials</h2><button className="quiet" onClick={() => { if (!dirty || globalThis.confirm("Leave unsaved edits?")) { setStudy(null); setDirty(false); } }}>Back to library</button></div>
            <Materials key={`${session.user.id}:${study.rootId}`} study={study} busy={busy} onWork={act} onUpload={upload} onSaved={value => { if (viewGeneration === generation.current) { setStudy(value); void load(); } }} />
            <GoalStage key={session.user.id} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} onDirty={value => { if (viewGeneration === generation.current) setDirty(value); }} appliedTopic={aiTopic} />
            {study.extractionId && <PlanEditor key={`${session.user.id}:${study.rootId}:${study.slots.filter(slot => slot.state === "removed").map(slot => slot.slotId).join(":")}`} study={study} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} onDirty={value => { if (viewGeneration === generation.current) setDirty(value); }} onSaved={value => { if (viewGeneration === generation.current) { setStudy(value); void load(); } }} draft={aiDraft} />}
            <AiAssist key={`${session.user.id}:${study.rootId}`} study={study} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} onTopic={setAiTopic} onDraft={setAiDraft} />
            {study.confirmed && <CheckStage key={`${session.user.id}:${study.rootId}:${study.revision}`} study={study} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} />}
            {study.confirmed && <CourseStage key={`course:${session.user.id}:${study.rootId}:${study.revision}`} study={study} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} onCourseReady={() => { if (viewGeneration === generation.current) void api<Study>(`studies/${study.rootId}`).then(value => { if (viewGeneration === generation.current) setStudy(value); }).catch(() => { /* the stage's own state stays authoritative */ }); }} />}
            {study.confirmed && <AssessmentStage key={`assessment:${session.user.id}:${study.rootId}:${study.revision}`} study={study} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} />}
            <DangerZone study={study} busy={busy} onWork={act} onDeleted={message => { setStudy(null); setDirty(false); setReceipt(message); void load().then(() => moveFocus()); }} />
          </>}
          <section className="library"><h2>Saved studies</h2>{entries.length === 0 ? <p>No saved studies yet.</p> : <ul>{entries.map(entry => <li key={entry.rootId}><div><strong>{entry.filename}</strong><p className="fine">{entry.state === "deleted" ? `Access revoked · cleanup ${entry.cleanupState}` : entry.confirmed ? (entry.courseGenerated ? "Plan confirmed · mini-course generated" : "Plan confirmed — course not generated") : `Manual draft · ${entry.state} · revision ${entry.revision}`}</p></div>{entry.state !== "deleted" && <button className="quiet" disabled={busy} onClick={() => { void open(entry.rootId); }}>{entry.confirmed ? "View plan" : "Resume"}</button>}</li>)}</ul>}</section>
          <ExportPanel busy={busy} onWork={act} />
          <PrivacyPanel />
        </>}
        <footer>Private by scope. Deliberate by design. <span>Local tracer — not approved for real data.</span></footer>
      </div>
    </main>
  </>;
}
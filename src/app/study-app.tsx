"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, command, json } from "./client";
import { PlanEditor } from "./plan-editor";
import { errorCode, messages } from "../platform/errors";
import type { Study } from "../modules/materials-setup/service";
import type { Receipt } from "../contracts/setup";

type Session = { user: { id: string; name: string }; needsRefresh: boolean };
type Entry = { rootId: string; filename: string; revision: number; state: string; confirmed: boolean; cleanupState: string };

export function StudyApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [study, setStudy] = useState<Study | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [viewGeneration, setViewGeneration] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const actionKeys = useRef(new Map<string, ReturnType<typeof command>>());
  const generation = useRef(0);
  const clear = useCallback(() => {
    generation.current += 1;
    setViewGeneration(generation.current); setBusy(false);
    setSession(null); setEntries([]); setStudy(null); setDirty(false); setRemoving(false); setReceipt(null); actionKeys.current.clear();
  }, []);
  const failure = useCallback((error: unknown) => {
    const code = errorCode(error);
    if (code === "UNAUTHENTICATED") clear();
    if (code === "FORBIDDEN_OR_NOT_FOUND") { setStudy(null); setDirty(false); setRemoving(false); }
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
  const state = study?.operation.state;
  useEffect(() => {
    if (!rootId || !["queued", "extracting", "retryable-failed"].includes(state ?? "")) return;
    const timer = setInterval(() => {
      const stamp = generation.current;
      void api<Study>(`studies/${rootId}`).then(value => { if (stamp === generation.current) setStudy(value); }).catch(error => { if (stamp === generation.current) failure(error); });
    }, 1000);
    return () => clearInterval(timer);
  }, [rootId, state, failure]);
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
    await act(async current => { const value = await api<Study>(`studies/${root}`); if (!current()) return; setStudy(value); setDirty(false); setReceipt(null); setRemoving(false); actionKeys.current.clear(); moveFocus(); });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setNotice(messages.INVALID_INPUT); return; }
    const intent = `${file.name}:${file.size}:${file.lastModified}`;
    let key = actionKeys.current.get(intent); if (!key) { key = command(); actionKeys.current.set(intent, key); }
    const uploadKey = key;
    await act(async current => {
      const result = await api<Receipt>("studies", { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", "x-filename": encodeURIComponent(file.name), "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": uploadKey.commandKey }, body: file });
      if (!current()) return;
      const value = await api<Study>(`studies/${result.rootId}`); if (!current()) return;
      setStudy(value); setReceipt(null); await load(); if (current()) moveFocus();
    });
  }
  async function remove() {
    if (!study) return;
    const intent = `remove:${study.rootId}`;
    let key = actionKeys.current.get(intent); if (!key) { key = command(study.revision); actionKeys.current.set(intent, key); }
    const deletion = key;
    await act(async current => {
      await api(`studies/${study.rootId}/removal`, json(deletion));
      if (!current()) return;
      setStudy(null); setDirty(false); setRemoving(false); setReceipt("Access revoked. Active-copy cleanup is pending or complete; see the library receipt below. No full retention or backup guarantee is claimed by this tracer.");
      await load(); moveFocus();
    });
  }
  return <>
    <a className="skip-link" href="#main">Skip to study workspace</a>
    <header className="topbar"><Link href="/" className="brand" prefetch={false}>Fieldnotes<span>PRIVATE STUDY</span></Link><span className="tag">Local · synthetic only</span>{session && <button className="quiet" onClick={() => { void signOut(); }}>Sign out</button>}</header>
    <main id="main" className="workspace">
      <aside className="sidebar"><p className="eyebrow">YOUR WORKSPACE</p><h2>Make room<br />for understanding.</h2><p>Read a source. Choose a direction. Shape a small, deliberate plan.</p><ol className="steps"><li>01 · Materials</li><li>02 · Topic & goal</li><li>03 · Manual plan</li></ol><p className="fine">No external AI calls. No generated courses. No completion credit.</p></aside>
      <div className="content">
        <p className="eyebrow">COMP5241 / STORY 01</p>
        <h1 ref={heading} tabIndex={-1}>{session ? study ? "From source to study plan" : "My study library" : "A private place to begin"}</h1>
        <p className="subtitle">A small, source-led learning journey. Your plan stays yours.</p>
        <div role="alert" className={notice ? "notice" : undefined}>{notice}</div>
        {!ready && <output>Checking your session…</output>}
        {ready && !session && <section className="panel"><h2>Sign in</h2><p>Use an operator-provisioned synthetic account. Public sign-up and self-promotion are unavailable.</p><form onSubmit={event => { void signIn(event); }}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required minLength={16} maxLength={128} /><button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form><p className="fine">Contact the local operator for account access or recovery.</p></section>}
        {session && <>
          <p className="fine">Signed in as {session.user.name}</p>
          {receipt && <section className="panel"><h2>Deletion receipt</h2><output>{receipt}</output></section>}
          {!study && <section className="panel"><h2>Start with a source</h2><p>Choose one non-empty UTF-8 TXT, up to 20 MiB. It is stored and extracted locally. Only TXT is available in this release.</p><form onSubmit={event => { void upload(event); }}><label htmlFor="file">Synthetic TXT material</label><input id="file" name="file" type="file" accept=".txt,text/plain" required /><button disabled={busy}>{busy ? "Uploading…" : "Upload TXT"}</button></form></section>}
          {study && <>
            <section className="panel"><div className="section-heading"><h2>01 · Your material</h2><button className="quiet" onClick={() => { if (!dirty || globalThis.confirm("Leave unsaved edits?")) { setStudy(null); setDirty(false); } }}>Back to library</button></div><p>{study.filename}</p><output>{study.operation.pending ? "Still processing — saved input is safe. Return later." : `Extraction: ${study.operation.state}`}</output>{study.text !== null && <details open><summary>Extracted text · UTF-8 source · preview before planning</summary><pre className="preview">{study.text}</pre></details>}{study.operation.state.includes("failed") && <p>Extraction did not finish. Saved input remains private. The worker retries bounded transient failures; remove and replace an unreadable source.</p>}</section>
            {study.extractionId && <PlanEditor key={`${session.user.id}:${study.rootId}`} study={study} busy={busy} onBusy={value => { if (viewGeneration === generation.current) setBusy(value); }} onFailure={error => { if (viewGeneration === generation.current) failure(error); }} onDirty={value => { if (viewGeneration === generation.current) setDirty(value); }} onSaved={value => { if (viewGeneration === generation.current) { setStudy(value); void load(); } }} />}
            <section className="danger-zone"><h2>Remove this material</h2><p>Deletes this original, extracted text and every dependent plan revision. Unrelated material stays available.</p>{!removing ? <button ref={deleteButton} className="danger" onClick={() => setRemoving(true)}>Review removal</button> : <fieldset><legend>Confirm material removal</legend><p>Access will stop immediately. Cleanup can remain pending. This cannot be undone.</p><button className="quiet" onClick={() => { setRemoving(false); requestAnimationFrame(() => deleteButton.current?.focus()); }}>Cancel removal</button><button className="danger" disabled={busy} onClick={() => { void remove(); }}>Delete material and dependent plans</button></fieldset>}</section>
          </>}
          <section className="library"><h2>Saved studies</h2>{entries.length === 0 ? <p>No saved studies yet.</p> : <ul>{entries.map(entry => <li key={entry.rootId}><div><strong>{entry.filename}</strong><p className="fine">{entry.state === "deleted" ? `Access revoked · cleanup ${entry.cleanupState}` : entry.confirmed ? "Plan confirmed — course not generated" : `Manual draft · ${entry.state} · revision ${entry.revision}`}</p></div>{entry.state !== "deleted" && <button className="quiet" disabled={busy} onClick={() => { void open(entry.rootId); }}>{entry.confirmed ? "View plan" : "Resume"}</button>}</li>)}</ul>}</section>
        </>}
        <footer>Private by scope. Deliberate by design. <span>Local tracer — not approved for real data.</span></footer>
      </div>
    </main>
  </>;
}
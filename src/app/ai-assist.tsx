"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiDraftView } from "../contracts/ai-setup";
import type { Plan } from "../contracts/setup";
import type { Study } from "../modules/materials-setup/service";
import { api, command, json } from "./client";
import { messages } from "../platform/errors";

type Props = {
  study: Study;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onFailure: (error: unknown) => void;
  onTopic: (value: { value: string; stamp: number } | null) => void;
  onDraft: (value: { plan: Plan; stamp: number } | null) => void;
};

type Disclosure = { configuration: { version: number; eligibility: "eligible" | "ineligible"; provider: string }; decision: "none" | "granted" | "declined" | "withdrawn" };

const failureCopy: Record<string, string> = {
  "provider-unavailable": "The AI endpoint is not configured on this machine. Nothing was generated.",
  "rate-limit": "The endpoint rate-limited the request. Wait a moment and retry.",
  authentication: "The endpoint rejected the configured key. Nothing was generated.",
  timeout: "The request timed out (120-second cap). Nothing was kept.",
  "invalid-output": "The model's reply did not match the required draft shape — rejected, not guessed.",
  "blocked-quota": "Daily request limit reached. Try again tomorrow.",
  "rejected-late": "Consent or your sources changed while the request ran; the result was discarded.",
  "AI_BUDGET_EXHAUSTED": messages.AI_BUDGET_EXHAUSTED,
};

// S6 AI assist: one advisory draft pipeline per request. Everything here is a
// SUGGESTION — topics pre-fill the Manual topic field and the draft loads into
// the plan editor as editable unsaved fields; saving and confirming stay Manual.
export function AiAssist({ study, busy, onBusy, onFailure, onTopic, onDraft }: Props) {
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [draft, setDraft] = useState<AiDraftView | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const [failureCode, setFailureCode] = useState("");
  const [note, setNote] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const stamp = useRef(0);
  const intent = useRef<ReturnType<typeof command> | null>(null);
  const rootId = study.rootId;

  useEffect(() => {
    let active = true;
    void api<Disclosure>("processing").then(value => { if (active) setDisclosure(value); }).catch(() => { /* The panel simply stays hidden on an unreadable disclosure. */ });
    return () => { active = false; if (poll.current) clearInterval(poll.current); };
  }, []);

  const stopPolling = useCallback(() => { if (poll.current) { clearInterval(poll.current); poll.current = null; } }, []);
  const pollDraft = useCallback(() => {
    if (poll.current) return;
    const started = Date.now();
    poll.current = setInterval(() => {
      void api<AiDraftView>(`studies/${rootId}/ai-draft`).then(value => {
        if (value.status === "pending") {
          // Honest pending cap: past 120 seconds the UI stops waiting even if
          // the job is still out; the request row keeps its own terminal state.
          if (Date.now() - started > 120_000) { stopPolling(); setState("failed"); setFailureCode("timeout"); setNote("The request is taking longer than 120 seconds. It was not retried."); }
          return;
        }
        stopPolling();
        if (value.status === "ready") { setDraft(value); setState("idle"); setNote("Draft ready below — review before using any of it."); }
        else { setDraft(null); setState("failed"); setFailureCode(value.failureCode ?? "provider-unavailable"); }
      }).catch(() => { stopPolling(); setState("failed"); setFailureCode("rejected-late"); });
    }, 1000);
  }, [rootId, stopPolling]);

  async function request() {
    // One command envelope per panel mount, reused across retries: the server's
    // command_receipt machinery replays it idempotently, so a lost response
    // can never double-dispatch.
    if (!intent.current) intent.current = command();
    const envelope = intent.current;
    onBusy(true); setState("pending"); setNote(""); setDraft(null);
    try {
      await api(`studies/${rootId}/ai-draft`, json({ ...envelope, expectedRevision: study.revision }));
      pollDraft();
    } catch (error) {
      setState("failed");
      setFailureCode("request-failed");
      setNote("");
      onFailure(error);
    } finally { onBusy(false); }
  }

  if (!disclosure || disclosure.configuration.eligibility !== "eligible") return null;
  const granted = disclosure.decision === "granted";
  const selectable = !!study.selection;
  return <section className="panel"><p className="eyebrow">AI ASSIST · ADVISORY ONLY</p><h3>Suggest a topic and draft (AI)</h3>
    <p className="fine">Owner-admitted endpoint ({disclosure.configuration.provider}); provider terms NOT verified — no compliance claim. Each request sends your selected source excerpts and stated goal/topic to the endpoint and counts against a bounded budget. Suggestions never save or confirm anything by themselves.</p>
    {!granted && <p className="fine">Allow processing for this provider in the Privacy &amp; data panel below first; declination keeps every Manual path working.</p>}
    <button disabled={busy || !granted || !selectable || state === "pending"} onClick={() => { void request(); }}>{state === "pending" ? "Requesting…" : "Request an AI draft"}</button>
    {!selectable && <p className="fine">Acknowledge your source selection above first.</p>}
    {state === "pending" && <output>Waiting for the draft (at most 120 seconds)…</output>}
    {state === "failed" && <output>{failureCopy[failureCode] ?? `The request failed (${failureCode}). Nothing was saved.`}      <button className="quiet" onClick={() => { void request(); }}>Retry</button></output>}
    {note && state !== "failed" && <output>{note}</output>}
    {draft?.status === "ready" && draft.result && <div className="ai-result">
      <p className="fine">Model {draft.model} · provider-claimed tokens {draft.usage?.totalTokens ?? "?"} (untrusted count). Review everything — nothing applies until you choose.</p>
      <h4>Candidate topics</h4>
      <ul>{draft.result.topics.map(topic => <li key={topic}><button className="quiet" onClick={() => onTopic({ value: topic, stamp: ++stamp.current })}>Use in topic field</button> {topic}</li>)}</ul>
      <button onClick={() => onDraft({ plan: draft.result!.plan, stamp: ++stamp.current })}>Load the draft into the plan editor</button>
      <p className="fine">Loading replaces the editor&apos;s unsaved fields; your previously saved revision is untouched until you save.</p>
    </div>}
  </section>;
}

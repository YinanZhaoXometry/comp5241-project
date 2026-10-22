"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Study } from "../modules/materials-setup/service";
import type { Slot } from "../modules/materials-setup/batches";
import type { SelectionCommand } from "../contracts/batches";
import { MAX_BYTES } from "../contracts/setup";
import { api, command, json } from "./client";

export function FilePicker({ busy, onUpload, remaining = 10 }: { busy: boolean; onUpload: (files: File[]) => Promise<void>; remaining?: number }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = new FormData(event.currentTarget).getAll("file").filter((file): file is File => file instanceof File && !!file.name);
    if (!files.length || files.length > remaining || files.some(file => !file.size || file.size > MAX_BYTES || !/\.(txt|md|pdf|docx)$/iu.test(file.name))) { setError("Choose up to ten PDF, DOCX, TXT or Markdown files, each nonempty and at most 20 MiB. Remove an input before replacing it at the ten-file limit."); return; }
    setError(""); await onUpload(files);
  }
  return <form onSubmit={event => { void submit(event); }}><p>PDF (text-based), DOCX, UTF-8 TXT or Markdown. Up to ten inputs, 20 MiB each. Local extraction only; no OCR, URLs, archives or external resources.</p><label htmlFor="file">Synthetic study materials</label><input id="file" name="file" type="file" multiple accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required disabled={busy || remaining === 0} /><div role="alert">{error}</div><button disabled={busy || remaining === 0}>{busy ? "Uploading…" : "Upload materials"}</button></form>;
}
const reasonText = { unsupported: "Unsupported format or file signature", protected: "Password-protected or encrypted document", corrupt: "Corrupt or invalid document", unsafe: "Unsafe document structure or external resource", "no-text": "No usable text; OCR is unavailable", resource: "Extraction exceeded a resource limit; simplify or replace this file", service: "Extraction service unavailable; saved input can be retried" };
type Props = { study: Study; busy: boolean; onWork: (work: (current: () => boolean) => Promise<void>) => Promise<void>; onSaved: (study: Study) => void; onUpload: (files: File[]) => Promise<void> };
export function Materials({ study, busy, onWork, onSaved, onUpload }: Props) {
  const [previews, setPreviews] = useState<Record<string, { extractionId: string; text: string }>>({});
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const keys = useRef(new Map<string, ReturnType<typeof command>>());
  function key(intent: string, revision: number) { let value = keys.current.get(intent); if (!value) { value = command(revision); keys.current.set(intent, value); } return value; }
  async function reload() { return api<Study>(`studies/${study.rootId}`); }
  async function preview(slot: Slot) {
    await onWork(async current => {
      const value = await api<{ extractionId: string; text: string }>(`sources/${slot.rootId}/${slot.extractionId}`);
      if (current()) setPreviews(previous => ({ ...previous, [slot.slotId]: value }));
    });
  }
  async function control(slot: Slot, action: "cancel" | "retry" | "remove") {
    await onWork(async current => {
      if (action === "remove") await api(`studies/${slot.rootId}/removal`, json(key(`remove:${slot.slotId}`, slot.revision)));
      else await api(`batches/${study.rootId}/slots/${slot.slotId}/control`, json({ ...key(`${action}:${slot.slotId}:${study.revision}`, study.revision), action }));
      const latest = await reload(); if (!current()) return;
      setPreviews(previous => { const next = { ...previous }; delete next[slot.slotId]; return next; });
      setChecked(previous => { const next = { ...previous }; delete next[slot.slotId]; return next; });
      setRemoving(null); onSaved(latest); setStatus(`${action === "remove" ? "Access revoked; cleanup pending or complete" : action === "cancel" ? "Extraction canceled; original saved" : "Retry queued using saved original"}. Review and acknowledge the current source selection again.`);
    });
  }
  async function resumeUpload(slot: Slot, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const file = new FormData(event.currentTarget).get("source");
    if (!(file instanceof File) || file.name !== slot.filename || file.size !== slot.byteLength) { setStatus("Choose the same named file and byte length for this saved upload slot, or remove and replace the slot."); return; }
    await onWork(async current => {
      await api(`batches/${study.rootId}/slots/${slot.slotId}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": key(`upload:${slot.slotId}`, 0).commandKey }, body: file });
      const latest = await reload(); if (current()) onSaved(latest);
    });
  }
  async function acknowledge() {
    const active = study.slots.filter(slot => slot.state !== "removed");
    const selected = active.filter(slot => slot.state === "preview" && slot.extractionId && checked[slot.slotId] === slot.extractionId).map(slot => ({ slotId: slot.slotId, extractionId: slot.extractionId!, acknowledged: true as const }));
    const excluded = active.filter(slot => !selected.some(source => source.slotId === slot.slotId)).map(slot => ({ slotId: slot.slotId, state: slot.state })) as SelectionCommand["excluded"];
    if (!selected.length) { setStatus("Inspect and acknowledge at least one successful extraction first."); return; }
    await onWork(async current => {
      await api(`batches/${study.rootId}/selection`, json({ ...key(`selection:${study.revision}:${JSON.stringify(selected)}`, study.revision), selected, excluded }));
      const latest = await reload(); if (current()) { onSaved(latest); setStatus("Exact sources acknowledged. Every other current input is explicitly excluded below; no files are silently omitted."); }
    });
  }
  return <><section className="panel"><h2>01 · Per-file previews</h2><output>{status}</output>
    <p>Inspect text, locations and warnings, then acknowledge the exact revisions for your Manual plan. Unchecked, failed and pending inputs will be explicitly excluded; acknowledgment is not factual verification.</p>
    {study.slots.map(slot => {
      const shown = slot.state === "preview" && previews[slot.slotId]?.extractionId === slot.extractionId ? previews[slot.slotId] : null;
      return <article className="material-slot" key={slot.slotId} aria-label={slot.filename}><h3>{slot.filename}</h3><output>{slot.pending ? "Still processing — saved input and operation are safe. Return later or cancel." : `Extraction: ${slot.state}`}</output><p className="fine">{slot.format.toUpperCase()} · {slot.byteLength} bytes{slot.operationId ? ` · Operation ${slot.operationId}` : ""}</p>
        {slot.reason && <p>{reasonText[slot.reason]}</p>}
        {slot.state === "awaiting-upload" && <form onSubmit={event => { void resumeUpload(slot, event); }}><label htmlFor={`source-${slot.slotId}`}>Retry upload · {slot.filename}</label><input id={`source-${slot.slotId}`} type="file" name="source" required disabled={busy} /><button disabled={busy}>Upload saved slot · {slot.filename}</button></form>}
        {slot.state === "preview" && <><button className="quiet" disabled={busy} onClick={() => { void preview(slot); }}>Inspect preview · {slot.filename}</button>{shown && <><pre className="preview">{shown.text}</pre><p>Warnings: {slot.metadata?.warnings.join(", ") || "None"}</p><ul className="fine">{slot.metadata?.locations.map((location, index) => <li key={index}>{location.source} · {location.unit} {location.first}–{location.last} · bytes {location.start}–{location.end}</li>)}</ul><label className="check-label"><input type="checkbox" checked={checked[slot.slotId] === slot.extractionId} disabled={busy} onChange={event => setChecked(previous => ({ ...previous, [slot.slotId]: event.target.checked ? slot.extractionId! : "" }))} />Acknowledge and select {slot.filename} · revision {slot.extractionId}</label></>}</>}
        <div className="actions">{["queued", "extracting", "retryable-failed"].includes(slot.state) && <button className="quiet" disabled={busy} onClick={() => { void control(slot, "cancel"); }}>Cancel extraction · {slot.filename}</button>}{["permanent-failed", "retryable-failed", "canceled"].includes(slot.state) && <button className="quiet" disabled={busy} onClick={() => { void control(slot, "retry"); }}>Retry saved input · {slot.filename}</button>}{slot.state !== "removed" && <button className="quiet" disabled={busy} onClick={() => setRemoving(slot.slotId)}>Remove or replace · {slot.filename}</button>}</div>
        {removing === slot.slotId && <fieldset><legend>Remove {slot.filename}?</legend><p>Access to this source and all dependent plans stops immediately. Other sources remain usable. To replace it, upload another input after removal.</p><button className="quiet" disabled={busy} onClick={() => setRemoving(null)}>Keep source</button><button className="danger" disabled={busy} onClick={() => { void control(slot, "remove"); }}>Remove source and dependent plans</button></fieldset>}
      </article>;
    })}
    <button disabled={busy} onClick={() => { void acknowledge(); }}>Continue with acknowledged selection</button>
    {study.selection && <div><h3>Acknowledged source set</h3><ul>{study.selection.sources.map(source => <li key={source.slotId}>{study.slots.find(slot => slot.slotId === source.slotId)?.filename} · extraction {source.extractionId}</li>)}{study.selection.excluded.map(source => <li key={source.slotId}>Excluded: {study.slots.find(slot => slot.slotId === source.slotId)?.filename} · {source.state}</li>)}</ul></div>}
  </section><section className="panel"><h2>Add or replace inputs</h2><FilePicker busy={busy} onUpload={onUpload} remaining={10 - study.slots.filter(slot => slot.state !== "removed").length} /></section></>;
}
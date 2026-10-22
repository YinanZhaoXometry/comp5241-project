"use client";

import { useRef, useState } from "react";
import type { Study } from "../modules/materials-setup/service";
import { api, command, json } from "./client";

type Category = { key: string; label: string; count: number };
type Preview = { scope: "root" | "personal"; categories: Category[]; deadlineDays: number; note: string };
type PersonalReceipt = { requestId: string; state: string; acceptedAt: string; deadlineAt: string };

type Work = (work: (current: () => boolean) => Promise<void>) => Promise<void>;

function CategoryList({ preview }: { preview: Preview }) {
  return <><ul>{preview.categories.map(category => <li key={category.key}>{category.label}: {category.count}</li>)}</ul><p className="fine">{preview.note} Active-copy purge is due within {preview.deadlineDays} days.</p></>;
}

// U8 whole-personal deletion flow: category preview first, cancellation is the
// safe default, and focus returns to the opener when the confirmation is
// canceled. The command key is reused across retries so a lost response replays.
function PersonalDeletionFlow({ busy, onWork, onDeleted, openerLabel }: { busy: boolean; onWork: Work; onDeleted: (receipt: string) => void; openerLabel: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const keys = useRef(new Map<string, ReturnType<typeof command>>());
  function key(intent: string) { let value = keys.current.get(intent); if (!value) { value = command(0); keys.current.set(intent, value); } return value; }
  async function review() {
    await onWork(async current => {
      const value = await api<Preview>("personal/removal", json({ schemaVersion: 1, preview: true }));
      if (current()) setPreview(value);
    });
  }
  function cancel() { setPreview(null); requestAnimationFrame(() => opener.current?.focus()); }
  async function remove() {
    const deletion = key("personal-removal");
    await onWork(async current => {
      const receipt = await api<PersonalReceipt>("personal/removal", json(deletion));
      if (!current()) return;
      const deadline = new Date(receipt.deadlineAt).toLocaleString();
      setPreview(null);
      onDeleted(`Personal study data deletion accepted (${receipt.state}). Access is revoked. Active-copy purge is due by ${deadline} (seven-day deadline; receipts expire within thirty days). Already downloaded bytes and prior disclosed external processing cannot be recalled. No full retention or backup guarantee is claimed.`);
    });
  }
  return <>{!preview ? <button ref={opener} className="danger" disabled={busy} onClick={() => { void review(); }}>{openerLabel}</button> : <fieldset><legend>Confirm personal data deletion</legend><p>Access stops immediately. Active copies purge within seven days. This cannot be undone.</p><CategoryList preview={preview} /><button className="quiet" disabled={busy} onClick={cancel}>Cancel personal deletion</button><button className="danger" disabled={busy} onClick={() => { void remove(); }}>Delete all my personal study data</button></fieldset>}</>;
}

type Props = { study: Study; busy: boolean; onWork: Work; onDeleted: (receipt: string) => void };

// Extracted from study-app's inline danger section (S9/U8): the same root
// removal flow plus a dependency preview by category with cancel-default, and
// a separate whole-personal deletion flow.
export function DangerZone({ study, busy, onWork, onDeleted }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const keys = useRef(new Map<string, ReturnType<typeof command>>());
  async function review() {
    await onWork(async current => {
      const value = await api<Preview>(`studies/${study.rootId}/dependencies`, json({ schemaVersion: 1 }));
      if (current()) setPreview(value);
    });
  }
  function cancel() { setPreview(null); requestAnimationFrame(() => opener.current?.focus()); }
  async function remove() {
    const intent = `remove:${study.rootId}`;
    let deletion = keys.current.get(intent); if (!deletion) { deletion = command(study.revision); keys.current.set(intent, deletion); }
    await onWork(async current => {
      await api(`studies/${study.rootId}/removal`, json(deletion!));
      if (!current()) return;
      setPreview(null);
      onDeleted("Access revoked. Active-copy cleanup is pending or complete; see the library receipt below. No full retention or backup guarantee is claimed by this tracer.");
    });
  }
  return <>
    <section className="danger-zone"><h2>Remove this material</h2><p>Deletes this original, extracted text and every dependent plan revision. Unrelated material stays available.</p>
      {!preview ? <button ref={opener} className="danger" disabled={busy} onClick={() => { void review(); }}>Review removal</button> : <fieldset><legend>Confirm material removal</legend><p>Access will stop immediately. Cleanup can remain pending. This cannot be undone.</p><CategoryList preview={preview} /><button className="quiet" disabled={busy} onClick={cancel}>Cancel removal</button><button className="danger" disabled={busy} onClick={() => { void remove(); }}>Delete material and dependent plans</button></fieldset>}
    </section>
    <section className="danger-zone"><h2>Delete all my personal study data</h2><p>Separate from removing one material: revokes every study, plan, check evidence, export and processing record under your account.</p>
      <PersonalDeletionFlow busy={busy} onWork={onWork} onDeleted={onDeleted} openerLabel="Review personal data deletion" />
    </section>
  </>;
}

// U3 withdrawal-offers-deletion link: P1's privacy panel renders this in the
// withdraw pending/withdrawn states. Explains what withdrawal does and does
// not do, then offers the same guarded personal deletion flow.
export function DeletionOffer({ busy, onWork, onDeleted }: { busy: boolean; onWork: Work; onDeleted: (receipt: string) => void }) {
  return <section className="danger-zone"><h3>Deletion option after withdrawal</h3><p>Withdrawal stops all future AI processing. Prior disclosed processing cannot be undone, and already-sent calls stay tracked. Withdrawal alone keeps your saved study work; deleting it is a separate, explicit choice.</p><PersonalDeletionFlow busy={busy} onWork={onWork} onDeleted={onDeleted} openerLabel="Review deletion of all my personal study data" /></section>;
}

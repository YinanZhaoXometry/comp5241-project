"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import { errorCode, messages } from "../platform/errors";
import type { ExportPreview, ExportSummary } from "../contracts/export";

type Props = { busy: boolean; onWork: (work: (current: () => boolean) => Promise<void>) => Promise<void> };

const stateText: Record<ExportSummary["state"], string> = {
  queued: "Queued — the local worker will build the snapshot.",
  running: "Building the consistent snapshot…",
  ready: "Ready for authenticated download.",
  failed: "Failed — nothing was published. Request a new export to try again.",
  expired: "Expired — the active copy was purged and can no longer be downloaded.",
  canceled: "Canceled — deletion or revocation landed while the snapshot was built, so no artifact was kept.",
};

function formatWhen(value: string) {
  return new Date(value).toLocaleString();
}

// Expiry is enforced durably at download and by the sweep; until such a pass
// runs, a ready row past its expires_at is displayed as expired because its
// artifact can no longer be downloaded.
function displayState(item: ExportSummary): ExportSummary["state"] {
  return item.state === "ready" && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now() ? "expired" : item.state;
}

// U7 owner export: scope and categories before request, durable
// queued/running/ready/failed/expired states, authenticated download only,
// expiry within 24 hours, explicit regeneration, honest snapshot boundary.
export function ExportPanel({ busy, onWork }: Props) {
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [notice, setNotice] = useState("");
  const pendingKey = useRef<ReturnType<typeof command> | null>(null);
  const reload = useCallback(async () => {
    try {
      const value = await api<ExportPreview>("exports");
      setPreview(value);
      setNotice("");
      const stillActive = value.requests.some(item => item.state === "queued" || item.state === "running");
      if (!stillActive) pendingKey.current = null; // next request is an explicit regeneration
    } catch (error) {
      setNotice(messages[errorCode(error)]);
    }
  }, []);
  const active = !!preview?.requests.some(item => item.state === "queued" || item.state === "running");
  useEffect(() => {
    // Deferred like the study app's initial load so the effect body never
    // sets state synchronously. A slow always-on refresh keeps the scope
    // counts honest after uploads; an active request polls at 1s.
    const initial = setTimeout(() => { void reload(); }, 0);
    const slow = setInterval(() => { void reload(); }, 5000);
    if (!active) return () => { clearTimeout(initial); clearInterval(slow); };
    const timer = setInterval(() => { void reload(); }, 1000);
    return () => { clearTimeout(initial); clearInterval(slow); clearInterval(timer); };
  }, [active, reload]);
  const latest = preview?.requests[0];
  async function request() {
    await onWork(async current => {
      const key = pendingKey.current ?? command();
      pendingKey.current = key;
      await api<{ rootId: string }>("exports", json(key));
      if (current()) await reload();
    });
  }
  return <section className="panel" aria-labelledby="export-heading">
    <h2 id="export-heading">Export your setup data</h2>
    <p className="fine">A snapshot pins your setup data exactly as captured. Later edits need another export. Downloads re-authorize your session, are never public links, and expire within 24 hours. Files already downloaded cannot be recalled.</p>
    <output>{notice}</output>
    <h3>Included categories</h3>
    <ul className="fine">{preview ? preview.categories.map(item => <li key={item.category}>{item.label}: {item.count !== null ? item.count : item.note ?? (item.available ? "included" : "not present in this deployment")}</li>) : <li>Checking your export scope…</li>}</ul>
    <button disabled={busy || active} onClick={() => { void request(); }}>{active ? "Export in progress…" : latest ? "Regenerate export" : "Request export snapshot"}</button>
    {preview && preview.requests.length > 0 && <div><h3>Export requests</h3><ul>{preview.requests.map(item => <li key={item.id}><div><strong>{displayState(item)}</strong><p className="fine">{stateText[displayState(item)]} · requested {formatWhen(item.createdAt)}{item.expiresAt ? ` · expires ${formatWhen(item.expiresAt)} (at most 24 hours)` : ""}{item.bytes ? ` · ${item.bytes} bytes` : ""}</p></div>{displayState(item) === "ready" && <a className="quiet" href={`/api/v1/exports/${item.id}/download`}>Download export · tar.gz</a>}{(displayState(item) === "expired" || displayState(item) === "failed" || displayState(item) === "canceled") && <p className="fine">Use “Regenerate export” for a fresh, explicit snapshot.</p>}</li>)}</ul></div>}
  </section>;
}

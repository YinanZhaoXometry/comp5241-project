"use client";

// Owner export / deletion receipt (sample port of temp/owner-export.html,
// setup states U7/U8). Export builds a sample JSON on this page and triggers
// a local Blob download — no network. Deletion is a quiet two-step danger
// zone: type DELETE to arm, confirm in a focus-managed dialog, end with a
// receipt. All state is memory-only; sample timestamps and the reference
// code are fixed constants so the sample renders deterministically.

import { useEffect, useRef, useState } from "react";
import kit from "../../kit.module.css";
import css from "./recall-screens.module.css";

// Fixed sample values — deterministic sample content, never live clock reads.
const EXPORTED_AT = "2026-10-23T10:15:00.000Z";
const RECEIPT_WHEN = "2026-10-23, 10:15 (sample)";
const RECEIPT_REF = "SAMPLE-DEL-4KQ7W2";

const EXPORT_PAYLOAD = {
  exportedAt: EXPORTED_AT,
  sample: true,
  note: "Simulated export from the Fieldnotes sample workspace. Not real user data.",
  studies: [
    {
      name: "How neural networks learn",
      goal: "Explain perceptrons, gradient descent, and backpropagation in plain words.",
      lessonsPlanned: 8,
    },
  ],
  materials: [
    { title: "Lecture slides, week 3", uploaded: "sample date" },
    { title: "Course notes, chapters 1–2", uploaded: "sample date" },
  ],
  practiceHistory: [
    { lesson: "Gradient descent, step by step", attempts: 3, misses: 1 },
    { lesson: "What a loss measures", attempts: 2, misses: 1 },
  ],
  reflections: [{ lesson: "Lesson 2", text: "Sample reflection text." }],
};

const INCLUDED: readonly { label: string; meta: string }[] = [
  { label: "Studies", meta: "— names, goals, and the plan you confirmed" },
  { label: "Materials list", meta: "— titles and upload dates, not the files themselves" },
  { label: "Practice history", meta: "— attempts, misses, and which feedback you saw" },
  { label: "Reflections", meta: "— the notes you wrote on the progress screen" },
];

type ExportPhase = "idle" | "preparing" | "ready" | "downloaded";

export function OwnerExport() {
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [typed, setTyped] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const timerRef = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);
  const deleteBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const receiptHeadRef = useRef<HTMLHeadingElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const armed = typed.trim() === "DELETE" && !deleted;

  // Release the sample timer/object URL when the screen unmounts.
  useEffect(() => {
    const timer = timerRef;
    const url = urlRef;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  // Native dialog contract: showModal moves it to the top layer with a focus
  // trap and built-in Esc handling; the close event (Esc or backdrop click
  // via close()) returns focus to the delete button.
  useEffect(() => {
    if (!confirmOpen) return;
    const dlg = dialogRef.current;
    if (!dlg) return;
    dlg.showModal();
    cancelRef.current?.focus();
    const onClose = () => {
      setConfirmOpen(false);
      deleteBtnRef.current?.focus();
    };
    dlg.addEventListener("close", onClose);
    return () => dlg.removeEventListener("close", onClose);
  }, [confirmOpen]);

  const closeConfirm = () => {
    dialogRef.current?.close();
  };

  const prepareExport = () => {
    setPhase("preparing");
    timerRef.current = window.setTimeout(() => {
      const blob = new Blob([JSON.stringify(EXPORT_PAYLOAD, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPhase("ready");
    }, 1200);
  };

  const downloadExport = () => {
    if (!urlRef.current) return;
    const a = document.createElement("a");
    a.href = urlRef.current;
    a.download = "fieldnotes-sample-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPhase("downloaded");
  };

  const confirmDelete = () => {
    setConfirmOpen(false);
    setDeleted(true);
    setTyped("");
    window.setTimeout(() => receiptHeadRef.current?.focus(), 0);
  };
  const statusText =
    phase === "idle"
      ? "In this sample, export is simulated — the file contains sample data, generated on this page. Nothing is sent anywhere."
      : phase === "preparing"
        ? "Preparing your export — gathering studies, practice history, and reflections…"
        : phase === "ready"
          ? "Your export is ready. The file is generated on this page from sample data."
          : "Download started. The file is a sample export — nothing was read from a server.";

  return (
    <div className={`${css.screen} ${css.w880}`}>
      <div>
        <h1 className={css.pageH1}>Your data</h1>
        <p className={css.sub}>
          Everything in this workspace belongs to you. Take it with you, or remove it entirely — both
          actions are shown here honestly, including what this sample can and cannot do.
        </p>
      </div>

      <section className={css.dataPanel} aria-labelledby="export-h">
        <h2 id="export-h" className={css.dataH2}>
          Export your data
        </h2>
        <p className={css.dataSub}>
          One JSON file containing everything the sample workspace holds for you:
        </p>
        <ul className={css.included}>
          {INCLUDED.map(item => (
            <li key={item.label}>
              {item.label} <span className={css.liMeta}>{item.meta}</span>
            </li>
          ))}
        </ul>
        <div className={css.exportActions}>
          <button
            type="button"
            className={kit.btnPrimary}
            onClick={prepareExport}
            disabled={phase !== "idle"}
          >
            Prepare export
          </button>
          <button
            type="button"
            className={kit.btnSecondary}
            onClick={downloadExport}
            disabled={phase !== "ready" && phase !== "downloaded"}
          >
            Download JSON
          </button>
        </div>
        <output className={css.exportStatus} aria-live="polite">
          {statusText}
        </output>
      </section>

      <section
        className={`${css.dataPanel} ${armed ? css.dangerArmed : ""}`}
        aria-labelledby="delete-h"
      >
        <h2 id="delete-h" className={css.dataH2}>
          Delete everything
        </h2>
        <p className={css.dangerExplain}>
          This removes every study, practice record, and reflection in the workspace. In this sample
          nothing is really stored, so nothing is really deleted — the receipt below shows what the
          real flow would confirm. In a live product this cannot be undone.
        </p>
        <div className={css.confirmRow}>
          <label className={css.confirmLabel} htmlFor="delete-confirm-input">
            Type DELETE to enable the button
          </label>
          <input
            id="delete-confirm-input"
            className={css.confirmInput}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="DELETE"
            value={typed}
            disabled={deleted}
            onChange={e => setTyped(e.target.value)}
          />
        </div>
        <div className={css.exportActions}>
          {/* The destructive button stays quiet until the flow is armed. */}
          <button
            type="button"
            ref={deleteBtnRef}
            className={armed ? kit.btnDanger : kit.btnQuiet}
            disabled={!armed}
            onClick={() => setConfirmOpen(true)}
          >
            Delete everything in this workspace
          </button>
        </div>

        {deleted && (
          <div className={css.receipt}>
            <h3 className={css.receiptH3} ref={receiptHeadRef} tabIndex={-1}>
              Deletion receipt (sample)
            </h3>
            <dl className={css.receiptDl}>
              <dt className={css.receiptDt}>What was deleted</dt>
              <dd className={css.receiptDd}>
                1 study, 8 lessons of practice history, 3 reflections, materials list
              </dd>
              <dt className={css.receiptDt}>When</dt>
              <dd className={css.receiptDd}>{RECEIPT_WHEN}</dd>
              <dt className={css.receiptDt}>Reference code</dt>
              <dd className={css.receiptDd}>{RECEIPT_REF}</dd>
            </dl>
            <p className={css.receiptNote}>
              This receipt is simulated. In a live product it would be your only confirmation that
              deletion completed — there is no recovery, and support cannot restore the data.
            </p>
          </div>
        )}
      </section>

      {confirmOpen && (
        <dialog ref={dialogRef} className={css.dlg} aria-labelledby="del-dlg-h">
          {/* Transparent full-bleed button = the backdrop close target
              (keyboard users close with Esc, as usual for dialogs). */}
          <button
            type="button"
            tabIndex={-1}
            className={css.dlgBackdrop}
            aria-label="Close without deleting"
            onClick={closeConfirm}
          />
          <div className={`${kit.dialogPanel} ${css.dlgPanel}`}>
            <h3 id="del-dlg-h" className={css.dlgH3}>
              Delete everything?
            </h3>
            <p className={css.dlgP}>
              Delete everything in this sample workspace? In a live product this cannot be undone. In
              this sample, no real data exists — this shows the receipt state only.
            </p>
            <div className={kit.btnRow}>
              <button type="button" className={kit.btnQuiet} ref={cancelRef} onClick={closeConfirm}>
                Cancel
              </button>
              <button type="button" className={kit.btnDanger} onClick={confirmDelete}>
                Delete everything
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import kit from "../../kit.module.css";
import sys from "./system-screens.module.css";

// Fixed sample rows for the loading→loaded example. Deterministic constants
// only — no clocks, no randomness, nothing fetched; state resets on reload.
const SAMPLE_STUDIES = [
  { title: "How neural networks learn", meta: "8 lessons · 12 of 19 complete", progress: 63 },
  { title: "Reading a real dataset", meta: "5 lessons · 7 of 20 complete", progress: 35 },
  { title: "Writing clear prompts", meta: "6 lessons · 14 of 17 complete", progress: 82 },
] as const;

const LOAD_DELAY_MS = 1600;

export function SystemStates() {
  const [loadPhase, setLoadPhase] = useState<"loading" | "loaded">("loading");
  const [retryNote, setRetryNote] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogResult, setDialogResult] = useState("");
  const [dangerArmed, setDangerArmed] = useState(false);
  const [dangerRemoved, setDangerRemoved] = useState(false);

  const dialogTitleId = useId();
  const dangerCheckId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Simulated load: memory-only timer, never a request. The pause lets the
  // skeleton be observed before the swap; reduced-motion only affects the
  // shimmer, not the transition.
  useEffect(() => {
    if (loadPhase !== "loading") return;
    const timer = setTimeout(() => {
      setLoadPhase("loaded");
    }, LOAD_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [loadPhase]);

  // Dialog contract: opening calls showModal() (native top layer, focus
  // containment, Esc-to-close via the cancel event) and moves focus to the
  // confirming verb; the close event returns focus to the opener. Backdrop
  // pointer dismissal is attached imperatively — Esc is the native keyboard
  // equivalent, and the dialog element must not carry JSX mouse handlers.
  const endDialog = useCallback(() => {
    setDialogOpen(false);
    openerRef.current?.focus();
  }, []);

  const closeDialog = useCallback((message: string) => {
    setDialogResult(message);
    dialogRef.current?.close();
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    confirmRef.current?.focus();
    function onDialogClick(event: MouseEvent) {
      // Backdrop clicks land on the dialog element itself, outside its
      // panel box.
      const host = dialogRef.current;
      if (!host || event.target !== host) return;
      const bounds = host.getBoundingClientRect();
      const outside =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom;
      if (outside) closeDialog("Dialog closed — nothing changed.");
    }
    dialog.addEventListener("click", onDialogClick);
    return () => {
      dialog.removeEventListener("click", onDialogClick);
    };
  }, [dialogOpen, closeDialog]);

  function removeStudy() {
    if (!globalThis.confirm("Remove this sample study? In a live product this cannot be undone.")) return;
    setDangerRemoved(true);
    setDangerArmed(false);
  }

  return (
    <div className={sys.states}>
      <header className={sys.statesHead}>
        <h1 className={sys.statesTitle}>System states</h1>
        <p className={sys.statesSub}>
          Every state pattern in the system, shown on the library screen as the host context. The rule across
          all of them: say what is true, say what still works, and never decorate a wait.
        </p>
      </header>

      <section className={sys.stateSection}>
        <h2 className={sys.sectionTitle}>Loading</h2>
        <p className={sys.usage}>
          Skeleton rows match the real row shape so content doesn’t jump when it arrives. The pulse animation
          collapses to static under prefers-reduced-motion; loading copy always says what is loading.
        </p>
        <div className={sys.example}>
          <p className={sys.frameTitle}>Library · while studies load — “Loading your saved studies…”</p>
          {loadPhase === "loading" ? (
            <div className={sys.skelList} aria-hidden="true">
              {SAMPLE_STUDIES.map((study) => (
                <div className={sys.skelRow} key={study.title}>
                  <div>
                    <div className={`${sys.skel} ${sys.skelTitle}`} />
                    <div className={`${sys.skel} ${sys.skelLine}`} />
                  </div>
                  <div className={kit.meter} />
                </div>
              ))}
            </div>
          ) : (
            <div className={sys.skelList}>
              {SAMPLE_STUDIES.map((study) => (
                <div className={sys.skelRow} key={study.title}>
                  <div>
                    <p className={sys.loadTitle}>{study.title}</p>
                    <p className={sys.loadMeta}>{study.meta}</p>
                  </div>
                  <div className={kit.meter}>
                    <span style={{ width: `${study.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <output className={`${kit.metaText} ${sys.noteBelow}`} aria-live="polite" aria-atomic="true">
            {loadPhase === "loading"
              ? "Loading your saved studies…"
              : "Loaded — showing 3 sample studies. The reload is simulated in this sample; no request is made."}
          </output>
          <button
            type="button"
            className={`${kit.btnQuiet} ${sys.noteBelow}`}
            disabled={loadPhase === "loading"}
            onClick={() => {
              setLoadPhase("loading");
            }}
          >
            Reload the example
          </button>
        </div>
      </section>

      <section className={sys.stateSection}>
        <h2 className={sys.sectionTitle}>Empty</h2>
        <p className={sys.usage}>
          Empty states state the fact, then offer one quiet next step. They never pad the screen with sample
          content to look alive, and they never blame the learner.
        </p>
        <div className={sys.example}>
          <p className={sys.frameTitle}>Library · state U3 — no studies yet</p>
          <div className={kit.empty}>
            <h3 className={sys.emptyTitle}>No saved studies yet</h3>
            <p className={sys.emptyBody}>
              When you create a study it will appear here with its plan and evidence. Starting empty is the
              normal beginning, not a problem.
            </p>
            <Link className={kit.btnSecondary} href="/demo/plan-ai" prefetch={false}>
              Create your first study
            </Link>
          </div>
        </div>
      </section>

      <section className={sys.stateSection}>
        <h2 className={sys.sectionTitle}>Error</h2>
        <p className={sys.usage}>
          Recoverable errors use the warm amber plate — never alarming red, which is reserved for destructive
          actions. Copy says what happened in plain language, what was kept safe, and offers one retry.
        </p>
        <div className={sys.example}>
          <p className={sys.frameTitle}>Library · studies failed to load</p>
          <div className={kit.notice} role="alert">
            <div className={sys.errBody}>
              <p className={sys.errTitle}>Your saved studies didn’t load.</p>
              <p className={sys.errText}>
                Nothing was lost — the list just couldn’t be fetched. Your studies are stored safely; this is a
                reading problem, not a saving problem.
              </p>
            </div>
            <button
              type="button"
              className={kit.btnSecondary}
              onClick={() => {
                setRetryNote("Retrying is simulated in this sample — no request is made.");
              }}
            >
              Try again
            </button>
          </div>
          <output className={`${kit.metaText} ${sys.noteBelow}`} aria-live="polite" aria-atomic="true">
            {retryNote}
          </output>
        </div>
      </section>

      <section className={sys.stateSection}>
        <h2 className={sys.sectionTitle}>Partial / offline-honest</h2>
        <p className={sys.usage}>
          The offline banner names exactly what still works and what is paused — it never pretends to be fully
          online, and it never overstates the outage. It sits above the content without blocking it.
        </p>
        <div className={sys.example}>
          <p className={sys.frameTitle}>Library · while offline</p>
          <output className={kit.notice} aria-live="polite">
            <strong className={sys.offlineStrong}>Offline.</strong>
            <span>
              You’re offline — showing your saved studies. Practice and AI features are paused until you
              reconnect; anything you read here is complete and current as of your last connection.
            </span>
          </output>
        </div>
      </section>

      <section className={sys.stateSection}>
        <h2 className={sys.sectionTitle}>Confirm dialog</h2>
        <p className={sys.usage}>
          For reversible-but-disruptive actions. Focus moves into the dialog on open, Esc closes it, and focus
          returns to the button that opened it. One primary action inside — the confirming verb.
        </p>
        <div className={sys.example}>
          <p className={sys.frameTitle}>Library · pausing a study’s reminders</p>
          <button
            ref={openerRef}
            type="button"
            className={kit.btnSecondary}
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Pause reminders for this study
          </button>
          <output className={`${kit.metaText} ${sys.noteBelow}`} aria-live="polite" aria-atomic="true">
            {dialogResult}
          </output>
        </div>
      </section>

      <section className={sys.stateSection}>
        <h2 className={sys.sectionTitle}>Danger zone</h2>
        <p className={sys.usage}>
          Quiet by design: a thin crimson border and an outlined danger button — never a filled red page.
          Two-step confirm, and danger is never styled like the terracotta primary CTA. The full pattern lives
          on the owner export screen.
        </p>
        <div className={sys.example}>
          <p className={sys.frameTitle}>Library · removing a study (sample)</p>
          <div className={sys.dangerZone}>
            <h3 className={sys.dangerTitle}>Remove this study</h3>
            <p className={sys.dangerText}>
              Removing a study deletes its plan, practice history, and reflections from this workspace. In a
              live product this cannot be undone.
            </p>
            <label className={sys.dangerCheck} htmlFor={dangerCheckId}>
              <input
                id={dangerCheckId}
                className={sys.dangerCheckInput}
                type="checkbox"
                checked={dangerArmed}
                onChange={(event) => {
                  setDangerArmed(event.target.checked);
                }}
              />
              I understand this removes the sample study and its history.
            </label>
            <button
              type="button"
              className={dangerArmed ? kit.btnDanger : kit.btnQuiet}
              disabled={!dangerArmed}
              onClick={removeStudy}
            >
              Remove study
            </button>
            {dangerRemoved ? (
              <output className={sys.dangerNote} aria-live="polite" aria-atomic="true">
                Sample only — nothing was removed. In a live product the study would be gone and a
                confirmation would appear here.
              </output>
            ) : null}
          </div>
        </div>
      </section>

      <dialog
        ref={dialogRef}
        className={`${kit.dialogPanel} ${sys.nativeDialog}`}
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        onCancel={() => {
          setDialogResult("Dialog closed — nothing changed.");
        }}
        onClose={endDialog}
      >
        <h3 id={dialogTitleId} className={sys.dialogTitle}>
          Pause reminders for “How neural networks learn”?
        </h3>
        <p className={sys.dialogBody}>
          Review items will stop coming due, and the study will leave the review inbox. Nothing is deleted
          — resuming puts items back at their current intervals.
        </p>
        <div className={sys.dialogActions}>
          <button
            type="button"
            className={kit.btnQuiet}
            onClick={() => {
              closeDialog("Reminders kept on — nothing changed.");
            }}
          >
            Keep reminders on
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={kit.btnPrimary}
            onClick={() => {
              closeDialog("Sample only — reminders would be paused for this study.");
            }}
          >
            Pause reminders
          </button>
        </div>
      </dialog>
    </div>
  );
}

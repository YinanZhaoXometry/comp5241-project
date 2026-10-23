"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import kit from "../kit.module.css";
import st from "./instructor.module.css";

/* Sample dialog frame on a native <dialog>: showModal() gives the keyboard
   contract (focus moves in, Tab trapped, Esc closes, top layer). Backdrop
   clicks are wired via a listener in the effect (not a JSX prop) and focus
   returns to the opener on any close. Memory-only — state resets on reload. */

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

type DialogFrameProps = {
  labelId: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  fallbackFocusTo?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

function DialogFrame({ labelId, onClose, returnFocusTo, fallbackFocusTo, children }: DialogFrameProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = returnFocusTo.current;
    const fallback = fallbackFocusTo?.current ?? null;
    dialog.showModal();
    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables.length > 0 ? focusables[0] : dialog).focus();
    function handleBackdropClick(event: MouseEvent) {
      if (event.target === dialog) onCloseRef.current();
    }
    function handleClose() {
      onCloseRef.current();
      if (opener && opener.isConnected) opener.focus();
      else if (fallback && fallback.isConnected) fallback.focus();
    }
    dialog.addEventListener("click", handleBackdropClick);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("click", handleBackdropClick);
      if (dialog.open) dialog.close();
      dialog.removeEventListener("close", handleClose);
    };
  }, [returnFocusTo, fallbackFocusTo]);

  return (
    <dialog ref={dialogRef} aria-labelledby={labelId} tabIndex={-1} className={st.dialogPanel}>
      {children}
    </dialog>
  );
}

/* ── sample data (fixed, original synthetic content) ─────────────────── */

type PillKind = "success" | "warn" | "muted";

type VersionEntry = {
  version: string;
  date: string;
  changes: string;
  state: PillKind;
  stateLabel: string;
};

type Course = {
  id: string;
  name: string;
  metaLine: string;
  currentVersion: string;
  statusKind: PillKind;
  statusLabel: string;
  versions: readonly VersionEntry[];
};

const COURSES: readonly Course[] = [
  {
    id: "nn",
    name: "Neural Networks Foundations",
    metaLine: "32 enrolled · Customized from library",
    currentVersion: "v1.3",
    statusKind: "success",
    statusLabel: "Published",
    versions: [
      { version: "v1.3", date: "2026-10-12", changes: "Added recall prompts to lessons 4–6; tightened lesson 5 summary.", state: "success", stateLabel: "Live" },
      { version: "v1.2", date: "2026-09-28", changes: "Fixed the gradient descent worked example; revised practice set.", state: "muted", stateLabel: "Superseded" },
      { version: "v1.1", date: "2026-09-10", changes: "Shortened lesson 2 readings; added one worked example.", state: "muted", stateLabel: "Superseded" },
      { version: "v1.0", date: "2026-08-30", changes: "Initial customization from library course “Intro to Neural Nets”.", state: "muted", stateLabel: "Superseded" },
    ],
  },
  {
    id: "ab",
    name: "Statistics for A/B Tests",
    metaLine: "18 enrolled · Generated from topic",
    currentVersion: "v1.1",
    statusKind: "warn",
    statusLabel: "Awaiting approval",
    versions: [
      { version: "v1.1", date: "2026-10-21", changes: "Rewrote lesson 3 on sample size; added two practice scenarios.", state: "warn", stateLabel: "In review" },
      { version: "v1.0", date: "2026-10-06", changes: "Generated from topic “A/B testing for product managers”; 10 lessons.", state: "success", stateLabel: "Live" },
    ],
  },
  {
    id: "tw",
    name: "Technical Writing Basics",
    metaLine: "12 enrolled · Customized from library",
    currentVersion: "v0.9",
    statusKind: "muted",
    statusLabel: "Draft",
    versions: [
      { version: "v0.9", date: "2026-10-19", changes: "Drafted lesson 5; practice prompts still unfinished.", state: "muted", stateLabel: "Draft" },
      { version: "v0.8", date: "2026-10-02", changes: "Initial customization from library course “Clear Technical Prose”.", state: "muted", stateLabel: "Draft" },
    ],
  },
];

const LIBRARY_COURSES = [
  { value: "intro-nn", name: "Intro to Neural Nets", meta: "Library · 8 lessons · by Fieldnotes editorial" },
  { value: "clear-prose", name: "Clear Technical Prose", meta: "Library · 6 lessons · by Fieldnotes editorial" },
  { value: "stats-101", name: "Everyday Statistics", meta: "Library · 10 lessons · by Fieldnotes editorial" },
] as const;

function StatusPill({ kind, label }: { kind: PillKind; label: string }) {
  const variant = kind === "success" ? kit.pillSuccess : kind === "warn" ? kit.pillWarn : kit.pillMuted;
  return (
    <span className={variant}>
      <span className={kit.dot} />
      {label}
    </span>
  );
}

/* ── screen ───────────────────────────────────────────────────────────── */

type DialogKind = "generate" | "customize" | "stub";

export function InstructorCourses() {
  const [openVersions, setOpenVersions] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [generateMsgShown, setGenerateMsgShown] = useState(false);
  const [pickedCourse, setPickedCourse] = useState<string | null>(null);
  const [customizeMsgShown, setCustomizeMsgShown] = useState(false);

  const generateBtnRef = useRef<HTMLButtonElement>(null);
  const customizeBtnRef = useRef<HTMLButtonElement>(null);
  const stubOpenerRef = useRef<HTMLElement | null>(null);

  function toggleVersions(id: string) {
    setOpenVersions(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function openStubDialog(opener: HTMLElement) {
    stubOpenerRef.current = opener;
    setDialog("stub");
  }

  return (
    <div className={`${st.screen} ${st.narrow}`}>
      <div className={st.pageHead}>
        <div>
          <h1 className={st.title}>Courses</h1>
          <p className={st.sub}>
            Courses you teach, with the version each enrolled student currently sees. Nothing publishes without an
            exact-version approval.
          </p>
        </div>
        <div className={st.pageActions}>
          <button
            ref={customizeBtnRef}
            type="button"
            className={st.secondaryBtn}
            onClick={() => {
              setPickedCourse(null);
              setCustomizeMsgShown(false);
              setDialog("customize");
            }}
          >
            Customize existing
          </button>
          <button
            ref={generateBtnRef}
            type="button"
            className={st.primaryBtn}
            onClick={() => {
              setGenerateMsgShown(false);
              setDialog("generate");
            }}
          >
            Generate from topic
          </button>
        </div>
      </div>

      <div className={st.courseList}>
        {COURSES.map(course => {
          const expanded = openVersions[course.id] === true;
          return (
            <article key={course.id} className={st.courseCard}>
              <div className={st.courseTop}>
                <div>
                  <h3 className={st.courseTitle}>{course.name}</h3>
                  <p className={st.courseMetaLine}>{course.metaLine}</p>
                </div>
                <div className={st.courseBadges}>
                  <span className={st.verChip}>{course.currentVersion}</span>
                  <StatusPill kind={course.statusKind} label={course.statusLabel} />
                </div>
              </div>
              <div className={st.courseActions}>
                <button type="button" className={st.quietBtn} onClick={event => openStubDialog(event.currentTarget)}>
                  Customize
                </button>
                <button type="button" className={st.quietBtn} onClick={event => openStubDialog(event.currentTarget)}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className={st.quietBtn}
                  aria-expanded={expanded}
                  aria-controls={`versions-${course.id}`}
                  onClick={() => toggleVersions(course.id)}
                >
                  {expanded ? "Hide versions" : "View versions"}
                </button>
              </div>
              {expanded && (
                <div className={st.versions} id={`versions-${course.id}`}>
                  <p className={st.verTitle}>Version history</p>
                  <div className={st.tableScroll}>
                    <table className={`${st.dataTable} ${st.verTable}`}>
                      <thead>
                        <tr>
                          <th>Version</th>
                          <th>Date</th>
                          <th>Changes</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {course.versions.map(entry => (
                          <tr key={entry.version}>
                            <td className={st.vNum}>{entry.version}</td>
                            <td className={st.vDate}>{entry.date}</td>
                            <td>{entry.changes}</td>
                            <td>
                              <StatusPill kind={entry.state} label={entry.stateLabel} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {dialog === "generate" && (
        <DialogFrame labelId="dlg-generate-title" onClose={() => setDialog(null)} returnFocusTo={generateBtnRef}>
          <div className={st.dlgHead}>
            <h2 id="dlg-generate-title" className={st.dlgTitle}>
              Generate a course from a topic
            </h2>
          </div>
          <div className={st.dlgBody}>
            <div className={st.dlgField}>
              <label htmlFor="gen-topic">Topic</label>
              <input id="gen-topic" className={kit.input} type="text" placeholder="e.g. Bayesian inference for product teams" />
            </div>
            <div className={st.honestyNote}>
              Materials: in a live setup you could attach readings or a syllabus, and every generated lesson would cite
              its sources. This sample attaches nothing.
            </div>
            <div className={st.honestyNote}>
              Sample — generates nothing. The button below reports what would happen instead of doing it.
            </div>
            {generateMsgShown && (
              <output className={st.dlgMsg}>
                In a live system this would draft a course outline from your topic for you to edit and submit for
                approval. Sample mode generated nothing.
              </output>
            )}
          </div>
          <div className={st.dlgFoot}>
            <button type="button" className={st.quietBtn} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className={st.secondaryBtn} onClick={() => setGenerateMsgShown(true)}>
              Generate draft
            </button>
          </div>
        </DialogFrame>
      )}

      {dialog === "customize" && (
        <DialogFrame labelId="dlg-customize-title" onClose={() => setDialog(null)} returnFocusTo={customizeBtnRef}>
          <div className={st.dlgHead}>
            <h2 id="dlg-customize-title" className={st.dlgTitle}>
              Customize an existing course
            </h2>
          </div>
          <div className={st.dlgBody}>
            <p>Pick a library course. You get a private, editable copy — the library original never changes.</p>
            <div className={st.pickList} role="radiogroup" aria-label="Library courses">
              {LIBRARY_COURSES.map(option => (
                <label key={option.value} className={st.pickRow}>
                  <input
                    type="radio"
                    name="pick-course"
                    value={option.value}
                    checked={pickedCourse === option.value}
                    onChange={() => setPickedCourse(option.value)}
                  />
                  <span className={st.pName}>
                    {option.name}
                    <span className={st.pMeta}>{option.meta}</span>
                  </span>
                </label>
              ))}
            </div>
            {customizeMsgShown && (
              <output className={st.dlgMsg}>
                Sample — no copy was created. In a live system this opens the editor on your private copy, versioned
                from v0.1.
              </output>
            )}
          </div>
          <div className={st.dlgFoot}>
            <button type="button" className={st.quietBtn} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={st.secondaryBtn}
              disabled={pickedCourse === null}
              onClick={() => setCustomizeMsgShown(true)}
            >
              Create editable copy
            </button>
          </div>
        </DialogFrame>
      )}

      {dialog === "stub" && (
        <DialogFrame labelId="dlg-stub-title" onClose={() => setDialog(null)} returnFocusTo={stubOpenerRef}>
          <div className={st.dlgHead}>
            <h2 id="dlg-stub-title" className={st.dlgTitle}>
              Not wired in this sample
            </h2>
          </div>
          <div className={st.dlgBody}>
            <p>This action is part of the instructor flow but is not implemented in the prototype. In a live system it opens the course editor.</p>
          </div>
          <div className={st.dlgFoot}>
            <button type="button" className={st.secondaryBtn} onClick={() => setDialog(null)}>
              Close
            </button>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}

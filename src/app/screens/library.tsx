// Library — saved studies list (static port of temp/library.html).
// Content column only: the product shell (sidebar/topbar/skip link/badge/
// footer) wraps this component. Pure static sample markup — no state, no
// handlers; the search input is inert, and the only links hand off to the
// functional tracer flow at "/". Ported to the 2026-10-23 Fieldnotes spine:
// tokens in globals.css :root, shared recipes in kit.module.css, screen
// styles in library.module.css. Coverage meters are native <progress>
// elements (implicit progressbar role) because the lint stack's
// jsx-a11y/prefer-tag-over-role forbids the literal role attribute; fills
// are dark --fg-2 per DESIGN.md §2, green (--success) for Mastered only.

import Link from "next/link";
import kit from "../kit.module.css";
import css from "./library.module.css";

type StudyStatus = "inProgress" | "reviewDue" | "mastered" | "draft";

type Study = {
  id: string;
  title: string;
  desc: string;
  status: StudyStatus;
  statusLabel: string;
  meta: string;
  /** null for the Draft row, whose side column is the "Resume setup" handoff. */
  coverage: number | null;
};

const STUDIES: readonly Study[] = [
  {
    id: "study-neural-networks",
    title: "How neural networks learn",
    desc: "From the perceptron to backpropagation — build the intuition by computing each step by hand before touching a framework.",
    status: "inProgress",
    statusLabel: "In progress",
    meta: "Lesson 3 of 8 · last opened today",
    coverage: 38,
  },
  {
    id: "study-bayesian",
    title: "Bayesian reasoning for everyday decisions",
    desc: "Priors, likelihoods, and updating beliefs — with practice drawn from medical testing and hiring scenarios.",
    status: "reviewDue",
    statusLabel: "Review due",
    meta: "4 recall items waiting · strongest if reviewed this week",
    coverage: 71,
  },
  {
    id: "study-photosynthesis",
    title: "Photosynthesis, from photon to sugar",
    desc: "The light reactions and the Calvin cycle, rebuilt as a causal chain you can explain without notes.",
    status: "mastered",
    statusLabel: "Mastered",
    meta: "Completed 12 Oct · next maintenance review in 3 weeks",
    coverage: 100,
  },
  {
    id: "study-sql-window",
    title: "Window functions in SQL",
    desc: "Draft plan — materials acknowledged, goal not yet confirmed. Pick up where you left off.",
    status: "draft",
    statusLabel: "Draft",
    meta: "Created 20 Oct · goal & plan unfinished",
    coverage: null,
  },
];

// Pill variant per DESIGN.md §7 — status is never color alone (dot + label).
const STATUS_PILL: Record<StudyStatus, string> = {
  inProgress: kit.pillAccent,
  reviewDue: kit.pillDanger,
  mastered: kit.pillSuccess,
  draft: kit.pillMuted,
};

export function LibraryScreen() {
  return (
    <div className={css.screen}>
      <div className={css.sectionHead}>
        <div>
          <h1 className={kit.display2}>Saved studies</h1>
          <p className={css.subtitle}>
            Everything you&apos;ve kept — courses in progress, drafts, and finished studies you
            can revisit.
          </p>
        </div>
        <Link href="/" prefetch={false} className={kit.btnPrimary}>
          New study
        </Link>
      </div>

      <div className={css.searchWrap}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          aria-hidden="true"
          className={css.searchIcon}
        >
          <circle cx={11} cy={11} r={7} />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          className={css.searchInput}
          placeholder="Search saved studies"
          aria-label="Search saved studies"
        />
      </div>

      <div className={css.studyList}>
        {STUDIES.map(study => (
          <article className={css.studyRow} key={study.id}>
            <div>
              <h2 className={css.studyTitle}>{study.title}</h2>
              <p className={css.studyDesc}>{study.desc}</p>
              <div className={css.rowMeta}>
                <span className={STATUS_PILL[study.status]}>
                  <span className={kit.dot} />
                  {study.statusLabel}
                </span>
                <span className={kit.metaText}>{study.meta}</span>
              </div>
            </div>
            <div className={css.studySide}>
              {study.coverage === null ? (
                <Link href="/" prefetch={false} className={kit.btnSecondary}>
                  Resume setup
                </Link>
              ) : (
                <>
                  <progress
                    className={
                      study.status === "mastered"
                        ? `${css.meter} ${css.meterGreen}`
                        : css.meter
                    }
                    value={study.coverage}
                    max={100}
                    aria-label={`Coverage ${study.coverage} percent`}
                  />
                  <span className={`${kit.metaText} ${kit.num}`}>
                    {study.coverage}% coverage
                  </span>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

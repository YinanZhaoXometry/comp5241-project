"use client";

import { useState } from "react";
import kit from "../../kit.module.css";
import st from "./instructor.module.css";

/* Instructor — Participation sample screen: surveillance-free engagement
   tracking. Provenance-labeled summary cards, honest "—" for missing data,
   per-lesson completion meters with dark ink fills, no rankings or
   gamification. The weekly summary is generated locally (Blob + anchor,
   no network). Memory-only — filter and download state reset on reload. */

type CourseKey = "nn" | "ab" | "tw";
type CourseFilter = "all" | CourseKey;

const SUMMARY_CARDS = [
  {
    n: "62",
    label: "Enrolled",
    how: "Every student on your three rosters (32 + 18 + 12), including invited students who have not joined yet.",
  },
  {
    n: "41",
    label: "Active this week",
    how: "Opened any lesson or practice session in the last 7 days. Invited students cannot count here.",
  },
  {
    n: "5 of 10",
    label: "Median progress",
    how: "Median lessons completed across active students, normalized to a 10-lesson course. A median, not an average, so one fast finisher does not skew it.",
  },
] as const;

const COURSE_NAMES: Record<CourseKey, string> = {
  nn: "Neural Networks Foundations",
  ab: "Statistics for A/B Tests",
  tw: "Technical Writing Basics",
};

type PracticeKind = "participating" | "paused" | "notyet";

type StudentRow = {
  id: string;
  course: CourseKey;
  name: string;
  done: string | null;
  last: string | null;
  practice: PracticeKind;
};

const STUDENTS: readonly StudentRow[] = [
  { id: "amara", course: "nn", name: "Amara Okafor", done: "6 of 8", last: "2 hours ago", practice: "participating" },
  { id: "jonas", course: "nn", name: "Jonas Lindqvist", done: "5 of 8", last: "Yesterday", practice: "participating" },
  { id: "daniel", course: "nn", name: "Daniel Osei", done: null, last: null, practice: "notyet" },
  { id: "priya", course: "nn", name: "Priya Nair", done: "4 of 8", last: "6 days ago", practice: "paused" },
  { id: "sofia", course: "ab", name: "Sofia Marchetti", done: "7 of 10", last: "3 days ago", practice: "participating" },
  { id: "grace", course: "ab", name: "Grace Nakamura", done: null, last: null, practice: "notyet" },
  { id: "ravi", course: "ab", name: "Ravi Patel", done: null, last: null, practice: "notyet" },
  { id: "lena", course: "tw", name: "Lena Fischer", done: "4 of 6", last: "5 days ago", practice: "participating" },
  { id: "omar", course: "tw", name: "Omar Haddad", done: "3 of 6", last: "1 week ago", practice: "paused" },
  { id: "ines", course: "tw", name: "Inés Duarte", done: null, last: null, practice: "notyet" },
];

type LessonBar = {
  n: number;
  label: string;
  sub?: string;
  done: number;
  total: number;
};

const COURSES: readonly { key: CourseKey; note: string; bars: readonly LessonBar[] }[] = [
  {
    key: "nn",
    note: "Lesson completion across 32 enrolled · v1.3 (approved)",
    bars: [
      { n: 1, label: "1 · What a neuron computes", done: 30, total: 32 },
      { n: 2, label: "2 · What a loss measures", done: 27, total: 32 },
      { n: 3, label: "3 · Gradient descent, step by step", sub: "Steepest drop-off — worth a look in class", done: 19, total: 32 },
      { n: 4, label: "4 · Overfitting and how to see it", done: 17, total: 32 },
      { n: 5, label: "5 · Reading a training curve", done: 14, total: 32 },
      { n: 6, label: "6 · Batches and epochs", done: 11, total: 32 },
      { n: 7, label: "7 · Activation functions, briefly", done: 9, total: 32 },
      { n: 8, label: "8 · Putting it together: a tiny network by hand", done: 6, total: 32 },
    ],
  },
  {
    key: "ab",
    note: "Lesson completion across 18 enrolled · v1.0 live (v1.1 awaiting approval)",
    bars: [
      { n: 1, label: "1 · What an A/B test can and cannot tell you", done: 15, total: 18 },
      { n: 2, label: "2 · Variants, metrics, and guardrails", done: 13, total: 18 },
      { n: 3, label: "3 · Sample size, in practice", done: 11, total: 18 },
      { n: 4, label: "4 · Randomization and why it breaks", done: 8, total: 18 },
      { n: 5, label: "5 · Reading a result without over-reading it", done: 7, total: 18 },
    ],
  },
  {
    key: "tw",
    note: "Lesson completion across 12 enrolled · v0.9 draft — students see v0.8",
    bars: [
      { n: 1, label: "1 · Sentences that carry weight", done: 9, total: 12 },
      { n: 2, label: "2 · Structure before style", done: 8, total: 12 },
      { n: 3, label: "3 · Writing for a reader in a hurry", done: 5, total: 12 },
      { n: 4, label: "4 · Editing your own draft", done: 4, total: 12 },
    ],
  },
];

const COURSE_FILTERS: readonly { key: CourseFilter; label: string }[] = [
  { key: "all", label: "All courses" },
  { key: "nn", label: COURSE_NAMES.nn },
  { key: "ab", label: COURSE_NAMES.ab },
  { key: "tw", label: COURSE_NAMES.tw },
];

/* Local-only download: builds the file in memory, never touches the network. */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function PracticePill({ kind }: { kind: PracticeKind }) {
  if (kind === "participating") {
    return (
      <span className={kit.pillSuccess}>
        <span className={kit.dot} />
        Participating
      </span>
    );
  }
  if (kind === "paused") {
    return (
      <span className={kit.pillWarn}>
        <span className={kit.dot} />
        Paused
      </span>
    );
  }
  return (
    <span className={kit.pillMuted}>
      <span className={kit.dot} />
      Not yet
    </span>
  );
}

export function InstructorParticipation() {
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("all");
  const [exported, setExported] = useState(false);

  const visibleStudents = courseFilter === "all" ? STUDENTS : STUDENTS.filter(row => row.course === courseFilter);
  const visibleCourses = courseFilter === "all" ? COURSES : COURSES.filter(course => course.key === courseFilter);

  function downloadSummary() {
    const csv = [
      "course,enrolled,active_this_week",
      "Neural Networks Foundations,32,24",
      "Statistics for A/B Tests,18,11",
      "Technical Writing Basics,12,6",
    ].join("\n");
    downloadText("fieldnotes-weekly-summary.csv", `${csv}\n`);
    setExported(true);
  }

  return (
    <div className={st.screen}>
      <div className={st.pageHead}>
        <div>
          <h1 className={st.title}>Participation</h1>
          <p className={st.sub}>
            A read on whether students are finding their way in — a signal for where to help, not a gradebook. Every
            number says how it was counted, and missing data is shown as missing.
          </p>
        </div>
        <div className={st.pageActions}>
          <button type="button" className={st.primaryBtn} onClick={downloadSummary}>
            Download weekly summary
          </button>
        </div>
      </div>

      {exported && (
        <output className={`${st.statusGood} ${st.exportMsg}`}>
          {"Weekly summary downloaded from this sample's data. In a live system it covers the last 7 days across your courses."}
        </output>
      )}

      <div className={st.summaryStrip}>
        {SUMMARY_CARDS.map(card => (
          <div key={card.label} className={st.sumCard}>
            <span className={st.sumNum}>{card.n}</span>
            <span className={st.sumLabel}>{card.label}</span>
            <p className={st.sumHow}>{card.how}</p>
          </div>
        ))}
      </div>

      <p className={st.supportNote}>
        Participation is shown to support learners, not to grade them. There are no rankings here, no streaks, and no
        scores — a quiet week is information for you, not a mark against a student.
      </p>

      <fieldset className={st.segFieldset}>
        <legend className={st.srOnly}>Filter by course</legend>
        <div className={st.seg}>
          {COURSE_FILTERS.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={st.segBtn}
              aria-pressed={courseFilter === tab.key}
              onClick={() => setCourseFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </fieldset>

      <section className={st.panel} aria-labelledby="per-student-h">
        <div className={st.panelHead}>
          <h2 id="per-student-h" className={st.panelTitle}>
            Per student
          </h2>
          <span className={st.panelNote}>Practice participation is self-paced — “Paused” is a student’s own choice, not a flag</span>
        </div>
        <div className={st.tableScroll}>
          <table className={`${st.dataTable} ${st.wideTable} ${st.middleTable}`} aria-label="Per-student participation">
            <thead>
              <tr>
                <th>Name</th>
                <th>Course</th>
                <th>Lessons done</th>
                <th>Last active</th>
                <th>Practice</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map(row => (
                <tr key={row.id}>
                  <td className={st.cellName}>{row.name}</td>
                  <td>{COURSE_NAMES[row.course]}</td>
                  <td className={st.cellMono}>
                    {row.done ?? <span className={st.noData}>—</span>}
                  </td>
                  <td className={st.cellTime}>{row.last ?? <span className={st.noData}>—</span>}</td>
                  <td>
                    <PracticePill kind={row.practice} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={st.tableLegend}>
          “—” means no activity recorded yet — the student may be invited or newly enrolled. It is reported as missing,
          never estimated.
        </p>
      </section>

      {visibleCourses.map(course => (
        <section key={course.key} className={st.panel} aria-labelledby={`course-${course.key}-h`}>
          <div className={st.panelHead}>
            <h2 id={`course-${course.key}-h`} className={st.panelTitle}>
              {COURSE_NAMES[course.key]}
            </h2>
            <span className={st.panelNote}>{course.note}</span>
          </div>
          <div className={st.lessonBars}>
            {course.bars.map(bar => (
              <div key={bar.n} className={st.barRow}>
                <span className={st.barName}>
                  {bar.label}
                  {bar.sub ? <span className={st.barSub}>{bar.sub}</span> : null}
                </span>
                <div className={`${kit.meter} ${st.barMeter}`} aria-hidden="true">
                  <span style={{ width: `${Math.round((bar.done / bar.total) * 100)}%` }} />
                </div>
                <span className={st.barCount}>
                  {bar.done} of {bar.total}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

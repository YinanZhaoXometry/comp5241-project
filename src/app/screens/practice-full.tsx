"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import kit from "../kit.module.css";
import styles from "./full-screens.module.css";

/* Practice & recall — full. Mixed question types with instructor-written
   hints and feedback, session-only scoring and a retry-missed round.
   Ported from temp/practice-full.html including its embedded script; all
   state is memory-only and resets on reload. */

type Tone = "muted" | "success" | "warn";
type Kind = "mc" | "recall" | "explain";
type Choice = { t: string; correct: boolean };
type Outcome = "correct" | "missed";

type Question = {
  id: string;
  kind: Kind;
  short: string;
  recall: string;
  tone: Tone;
  tag: string;
  text: string;
  hint?: string;
  choices?: Choice[];
  placeholder?: string;
  model?: string;
  note?: string;
  ok: string;
  no: string;
};

const QUESTIONS: readonly Question[] = [
  {
    id: "q1",
    kind: "mc",
    short: "Recognition",
    recall: "New",
    tone: "muted",
    tag: "Multiple choice · Lesson 3 · Gradient descent",
    text: "You run one training step and the loss increases sharply. What is the most likely cause?",
    hint: "Think about the hillside: what happens to your position if one step is longer than the valley is wide?",
    choices: [
      { t: "The model has memorized the training data.", correct: false },
      { t: "The learning rate is too large, so the step overshot the valley.", correct: true },
      { t: "The gradient was computed on too few examples.", correct: false },
      { t: "The loss function was chosen incorrectly.", correct: false },
    ],
    ok: "A rising loss right after a step is the classic signature of overshooting — the step was longer than the valley is wide. Halving the learning rate is the usual first move.",
    no: "Picture the hillside again. Overshooting the valley floor makes the loss jump up; memorization and small batches behave differently.",
  },
  {
    id: "q2",
    kind: "mc",
    short: "Recognition",
    recall: "Strengthening",
    tone: "success",
    tag: "Multiple choice · Lesson 2 · What a loss measures",
    text: "In one sentence, what does the loss function measure?",
    hint: "It is a single number, computed after every prediction, that the training loop tries to shrink.",
    choices: [
      { t: "How wrong the model’s predictions are, as a single number.", correct: true },
      { t: "How fast the network runs on the training hardware.", correct: false },
      { t: "How many weights the network contains.", correct: false },
      { t: "How similar two training examples are to each other.", correct: false },
    ],
    ok: "Exactly — the loss compresses “how wrong are we” into one number, so the optimizer always knows which way is downhill.",
    no: "The loss is about correctness, not speed or size. It turns “how wrong are the predictions” into one number the optimizer can minimize.",
  },
  {
    id: "q3",
    kind: "recall",
    short: "Recall",
    recall: "Fuzzy",
    tone: "warn",
    tag: "Free recall · Lesson 3 · Gradient descent",
    text: "Without looking back: write the one line of code that performs a single gradient descent step.",
    placeholder: "w = …",
    model: "w = w - lr * grad",
    ok: "Right. The gradient points uphill, so the step subtracts it — scaled by the learning rate so each step stays small.",
    no: "Direction matters: the gradient points uphill, so the update subtracts it. The instructor’s line is shown above.",
  },
  {
    id: "q4",
    kind: "explain",
    short: "Explain-back",
    recall: "Strengthening",
    tone: "success",
    tag: "Explain it back · Lesson 3 · Gradient descent",
    text: "In your own words: why does gradient descent move the weights against the gradient, not along it?",
    placeholder: "The gradient points uphill, so…",
    note: "The gradient of the loss points in the direction the loss increases fastest — uphill on the hillside. Training wants the loss to shrink, so each step moves a small amount the opposite way. Moving along the gradient would climb the hill, and the loss would grow.",
    ok: "Self-graded as explained. Honest self-grading is what makes the explain-back count as recall evidence.",
    no: "Logged as still fuzzy — this stays in your review queue at a short interval. That is the queue working, not a failure.",
  },
] as const;

const QUESTION_BY_ID: ReadonlyMap<string, Question> = new Map(
  QUESTIONS.map((q) => [q.id, q]),
);

type QState = {
  selected: number;
  checked: boolean;
  correct: boolean;
  hintShown: boolean;
  attempt: string;
  noteShown: boolean;
};

function freshState(): QState {
  return {
    selected: -1,
    checked: false,
    correct: false,
    hintShown: false,
    attempt: "",
    noteShown: false,
  };
}

function recallTitle(recall: string): string {
  if (recall === "New") return "First time this question appears in practice";
  if (recall === "Fuzzy") return "Last recall was hesitant — this one is on a short interval";
  return "Recalled successfully before";
}

const TONE_PILL: Record<Tone, string> = {
  muted: kit.pillMuted,
  success: kit.pillSuccess,
  warn: kit.pillWarn,
};

function focusSoon(el: React.RefObject<HTMLElement | null>) {
  window.setTimeout(() => el.current?.focus(), 0);
}

export function PracticeFull() {
  const [qstate, setQstate] = useState<Record<string, QState>>(() =>
    Object.fromEntries(QUESTIONS.map((q) => [q.id, freshState()])),
  );
  const [results, setResults] = useState<{
    r1: Record<string, Outcome>;
    r2: Record<string, Outcome>;
  }>({ r1: {}, r2: {} });
  const [round, setRound] = useState(1);
  const [order, setOrder] = useState<string[]>(() =>
    QUESTIONS.map((q) => q.id),
  );
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState<"questions" | "summary">("questions");
  const qTitleRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);

  const q = QUESTION_BY_ID.get(order[pos]) as Question;
  const s = qstate[q.id];

  function updateQ(id: string, patch: Partial<QState>) {
    setQstate((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function record(r: number, id: string, outcome: Outcome) {
    setResults((prev) =>
      r === 1
        ? { ...prev, r1: { ...prev.r1, [id]: outcome } }
        : { ...prev, r2: { ...prev.r2, [id]: outcome } },
    );
  }

  function select(i: number) {
    if (s.checked) return;
    updateQ(q.id, { selected: i });
  }

  function check() {
    if (s.checked) return;
    if (q.kind === "mc") {
      if (s.selected < 0) return;
      const correct = q.choices?.[s.selected].correct ?? false;
      updateQ(q.id, { checked: true, correct });
      record(round, q.id, correct ? "correct" : "missed");
    } else if (q.kind === "recall") {
      const norm = s.attempt.toLowerCase().replace(/\s+/g, "");
      const correct = norm.includes("w=w-lr*grad");
      updateQ(q.id, { checked: true, correct });
      record(round, q.id, correct ? "correct" : "missed");
    } else {
      if (s.attempt.trim().length === 0) return;
      updateQ(q.id, { noteShown: true });
    }
  }

  function selfGrade(explained: boolean) {
    if (s.checked) return;
    updateQ(q.id, { checked: true, correct: explained });
    record(round, q.id, explained ? "correct" : "missed");
  }

  function next() {
    if (pos < order.length - 1) {
      setPos(pos + 1);
      focusSoon(qTitleRef);
    } else {
      setPhase("summary");
      focusSoon(summaryRef);
    }
  }

  const missedRound1 = QUESTIONS.filter(
    (item) => results.r1[item.id] === "missed",
  ).map((item) => item.id);
  const isFinal = round === 2 || missedRound1.length === 0;

  function retryMissed() {
    setRound(2);
    setOrder(missedRound1.slice());
    setPos(0);
    setQstate((prev) => {
      const next = { ...prev };
      for (const id of missedRound1) next[id] = freshState();
      return next;
    });
    setPhase("questions");
    focusSoon(qTitleRef);
  }

  const answered = order.filter((id) => qstate[id].checked).length;

  function outcomeOf(id: string): { ok: boolean; label: string } {
    if (results.r1[id] === "correct") return { ok: true, label: "First try" };
    if (results.r2[id] === "correct")
      return { ok: true, label: "Recalled on retry" };
    return { ok: false, label: "Missed · queued for review inbox" };
  }

  const stillMissed = QUESTIONS.filter((item) => !outcomeOf(item.id).ok).length;
  const lastLabel =
    pos === order.length - 1
      ? round === 1
        ? "See summary"
        : "See final summary"
      : "Next question";

  const metaText =
    phase === "summary"
      ? isFinal
        ? "Final summary"
        : "Session summary"
      : `${round === 2 ? "Retry question" : "Question"} ${pos + 1} of ${order.length}`;

  return (
    <div className={styles.narrow}>
      <div className={styles.pageHead}>
        <h1 className={styles.titleXl}>Practice &amp; recall</h1>
        <p className={styles.sub}>
          Four questions on this study: two assisted multiple choice, one free
          recall, one explain-back you grade yourself. Hints and feedback were
          written by the instructor — nothing is generated live. Missed
          questions go to your review inbox.
        </p>
        <span className={`${kit.metaText} ${styles.metaLine}`}>
          Practice &amp; recall — full · How neural networks learn · {metaText}
        </span>
      </div>

      <ol className={styles.miniList} aria-label="Questions in this session">
        {order.map((id, i) => {
          const item = qstate[id];
          const state = item.checked
            ? item.correct
              ? "correct"
              : "missed"
            : i === pos && phase === "questions"
              ? "current"
              : undefined;
          return (
            <li
              key={id}
              className={`${styles.miniItem} ${state ? styles[state] : ""}`}
            >
              <span className={styles.miniDot} aria-hidden="true" />
              <span>
                {(round === 1 ? "Question " : "Retry ") + (i + 1)} ·{" "}
                {QUESTION_BY_ID.get(id)?.short}
              </span>
            </li>
          );
        })}
      </ol>

      <div className={styles.sessionMeter} aria-live="polite">
        <div className={styles.meterLabel}>
          <span>
            Answered <span className={kit.num}>{answered}</span> of{" "}
            <span className={kit.num}>{order.length}</span>
            {round === 2 ? " · retry round" : ""}
          </span>
          <span>This session only — not a stored score</span>
        </div>
        <div className={kit.meter} aria-hidden="true">
          <span
            className={styles.meterFill}
            style={{ width: `${(answered / order.length) * 100}%` }}
          />
        </div>
      </div>

      {phase === "questions" ? (
        <section className={styles.qCard} aria-labelledby="pf-q-text">
          <div className={styles.qMeta}>
            <span className={styles.qTag}>{q.tag}</span>
            <span className={TONE_PILL[q.tone]} title={recallTitle(q.recall)}>
              <span className={kit.dot} />
              {q.recall}
            </span>
          </div>
          <h2
            id="pf-q-text"
            ref={qTitleRef}
            tabIndex={-1}
            className={`${styles.titleLg} ${styles.qTitle}`}
          >
            {q.text}
          </h2>

          {q.kind === "mc" && (
            <div className={styles.hintBlock}>
              <button
                type="button"
                className={styles.hintToggle}
                aria-expanded={s.hintShown}
                aria-controls="pf-hint-panel"
                onClick={() => updateQ(q.id, { hintShown: !s.hintShown })}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                  <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" />
                </svg>
                {s.hintShown ? "Hide the hint" : "Show a hint"}
              </button>
              {s.hintShown && (
                <div className={styles.hintPanel} id="pf-hint-panel">
                  <span>{q.hint}</span>
                  <span className={styles.hintSrc}>
                    Hint written by the instructor · shown because you asked
                  </span>
                </div>
              )}
            </div>
          )}

          {q.kind === "mc" && (
            <div
              className={styles.answers}
              role="radiogroup"
              aria-label="Answer choices"
            >
              {q.choices?.map((c, i) => {
                const showCorrect = s.checked && c.correct;
                const showMissed = s.checked && s.selected === i && !c.correct;
                const isSelected = !s.checked && s.selected === i;
                const rowCls = showCorrect
                  ? `${kit.answerRowLocked} ${styles.rowCorrect} ${styles.rowWrap}`
                  : showMissed
                    ? `${kit.answerRowLocked} ${styles.rowMissed} ${styles.rowWrap}`
                    : isSelected
                      ? `${kit.answerRowSelected} ${styles.rowWrap}`
                      : s.checked
                        ? `${kit.answerRowLocked} ${styles.rowWrap}`
                        : `${kit.answerRow} ${styles.rowWrap}`;
                const dotCls = showCorrect
                  ? `${styles.ansDot} ${styles.dotOk}`
                  : showMissed
                    ? `${styles.ansDot} ${styles.dotMiss}`
                    : styles.ansDot;
                return (
                  <label key={c.t} className={rowCls}>
                    <input
                      type="radio"
                      className={styles.ansInput}
                      name={`pf-answers-${q.id}`}
                      checked={s.checked ? c.correct || s.selected === i : isSelected}
                      disabled={s.checked}
                      onChange={() => select(i)}
                    />
                    <span className={dotCls} aria-hidden="true" />
                    <span>{c.t}</span>
                  </label>
                );
              })}
            </div>
          )}

          {q.kind !== "mc" && (
            <div className={styles.recallWrap}>
              <label className={styles.recallLabel} htmlFor="pf-recall">
                {q.kind === "recall"
                  ? "Your answer — write it before you check"
                  : "Your explanation — write it before you compare"}
              </label>
              <textarea
                id="pf-recall"
                className={`${kit.textarea} ${styles.recallArea} ${
                  q.kind === "recall" ? styles.recallCode : ""
                }`}
                placeholder={q.placeholder}
                value={s.attempt}
                disabled={s.checked || s.noteShown}
                onChange={(e) => updateQ(q.id, { attempt: e.target.value })}
              />
            </div>
          )}

          <div className={styles.qActions}>
            <div className={kit.btnRow}>
              {!s.checked && !s.noteShown && (
                <button
                  type="button"
                  className={kit.btnPrimary}
                  disabled={
                    q.kind === "mc"
                      ? s.selected < 0
                      : s.attempt.trim().length === 0
                  }
                  onClick={check}
                >
                  {q.kind === "explain"
                    ? "Compare with the instructor’s note"
                    : "Check answer"}
                </button>
              )}
              {s.checked && (
                <button
                  type="button"
                  className={kit.btnPrimary}
                  onClick={next}
                >
                  {lastLabel}
                </button>
              )}
            </div>
            <span className={styles.assistive}>
              {s.checked
                ? s.correct
                  ? `Answered correctly${
                      round === 2 ? " on retry." : " on the first try."
                    }`
                  : "Missed — this question is queued in your review inbox."
                : q.kind === "explain"
                  ? s.noteShown
                    ? "Grade yourself against the note to continue."
                    : "You grade this one yourself against the instructor’s note."
                  : "One attempt per question in this sample."}
            </span>
          </div>

          {s.noteShown && !s.checked && q.note && (
            <div
              className={`${styles.feedback} ${styles.feedbackNote}`}
              aria-live="polite"
            >
              <span className={styles.fbTitle}>Instructor’s note</span>
              <p>{q.note}</p>
              <span className={styles.fbSrc}>
                Note written by the instructor — compare honestly, then grade
                yourself below.
              </span>
              <div className={styles.selfGrade}>
                <span className={styles.selfLabel}>
                  Compared to the note, how did you do?
                </span>
                <button
                  type="button"
                  className={kit.btnSecondary}
                  onClick={() => selfGrade(true)}
                >
                  I explained it
                </button>
                <button
                  type="button"
                  className={kit.btnSecondary}
                  onClick={() => selfGrade(false)}
                >
                  Still fuzzy
                </button>
              </div>
            </div>
          )}

          {s.checked && (
            <div
              className={`${styles.feedback} ${
                s.correct ? styles.feedbackOk : styles.feedbackNo
              }`}
              aria-live="polite"
            >
              <span className={styles.fbTitle}>
                {s.correct
                  ? "Right."
                  : q.kind === "explain"
                    ? "Marked as still fuzzy."
                    : "Not quite."}
              </span>
              {q.kind === "recall" && q.model && (
                <span className={styles.fbModel}>{q.model}</span>
              )}
              {q.kind === "explain" && q.note && <p>{q.note}</p>}
              <p>{s.correct ? q.ok : q.no}</p>
              <span className={styles.fbSrc}>
                Feedback written by the instructor — prewritten, not generated
                live.
              </span>
              {!s.correct && (
                <p>
                  <Link
                    className={styles.fbLink}
                    href="/course"
                    prefetch={false}
                  >
                    Revisit this in the course →
                  </Link>
                  <Link
                    className={styles.fbLink}
                    href="/review"
                    prefetch={false}
                  >
                    See it in your review inbox →
                  </Link>
                </p>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className={styles.summary} aria-labelledby="pf-summary-h">
          <h2
            id="pf-summary-h"
            ref={summaryRef}
            tabIndex={-1}
            className={styles.titleLg}
          >
            {isFinal ? "Practice complete" : "Session complete"}
          </h2>
          {round === 1 && missedRound1.length > 0 ? (
            <>
              <p className={styles.bodyText}>
                Session score:{" "}
                {order.filter((id) => results.r1[id] === "correct").length} of{" "}
                {order.length} on the first try — this session only, not a
                stored score. The missed{" "}
                {missedRound1.length === 1 ? "question is" : "questions are"}{" "}
                queued in your review inbox, and you can retry{" "}
                {missedRound1.length === 1 ? "it" : "them"} right now.
              </p>
              <p className={styles.honestNote}>
                Nothing here is a grade. Retrying only re-asks what you missed
                — the review inbox keeps the longer-term schedule.
              </p>
            </>
          ) : (
            <>
              <p className={styles.bodyText}>
                {stillMissed === 0
                  ? `Every question recalled correctly${
                      round === 2 ? " after the retry round" : " on the first try"
                    }. Session score kept on this screen only — the review inbox will space these topics out rather than repeat them tomorrow.`
                  : `Retry round done. ${stillMissed} ${
                      stillMissed === 1 ? "question is" : "questions are"
                    } still fuzzy and stays in your review inbox at a short interval — that is the schedule working, not a failure.`}
              </p>
              <p className={styles.honestNote}>
                Nothing here is a grade and no score is stored. Missed and
                fuzzy items live in the review inbox with the lesson they came
                from.
              </p>
            </>
          )}
          <div className={styles.summaryRows}>
            {QUESTIONS.filter((item) => isFinal || results.r1[item.id]).map(
              (item) => {
                const res = outcomeOf(item.id);
                return (
                  <div className={styles.sRow} key={item.id}>
                    <span
                      className={`${styles.sDot} ${
                        res.ok ? styles.sDotOk : styles.sDotNo
                      }`}
                      aria-hidden="true"
                    />
                    <span className={styles.sQ}>{item.tag}</span>
                    <span className={styles.sState}>{res.label}</span>
                  </div>
                );
              },
            )}
          </div>
          <div className={styles.sActions}>
            {round === 1 && missedRound1.length > 0 ? (
              <>
                <button
                  type="button"
                  className={kit.btnPrimary}
                  onClick={retryMissed}
                >
                  Retry missed questions ({missedRound1.length})
                </button>
                <Link
                  className={kit.btnSecondary}
                  href="/review"
                  prefetch={false}
                >
                  Open review inbox
                </Link>
              </>
            ) : (
              <>
                <Link
                  className={kit.btnPrimary}
                  href={
                    stillMissed > 0 ? "/review" : "/course"
                  }
                  prefetch={false}
                >
                  {stillMissed > 0 ? "Open review inbox" : "Back to the course"}
                </Link>
                <Link
                  className={kit.btnSecondary}
                  href="/roadmap"
                  prefetch={false}
                >
                  See the roadmap
                </Link>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

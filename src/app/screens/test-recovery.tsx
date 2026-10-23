"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import kit from "../kit.module.css";
import styles from "./full-screens.module.css";

/* Test & recovery. Gap-targeted diagnostic with per-topic Solid / Needs-work
   results and an inline recovery checklist (refresher + retry question).
   Ported from temp/test-recovery.html including its embedded script; no
   grades or percentages, honest scheduling copy, memory-only state. */

type TopicId = "gradient-intuition" | "learning-rate" | "loss-meaning";
type Kind = "mc" | "recall";
type Choice = { t: string; correct: boolean };

type Topic = { name: string; lesson: string };

const TOPICS: Record<TopicId, Topic> = {
  "gradient-intuition": {
    name: "Gradient descent intuition",
    lesson: "Lesson 3 · Gradient descent, step by step",
  },
  "learning-rate": {
    name: "The learning rate",
    lesson: "Lesson 3 · Gradient descent, step by step",
  },
  "loss-meaning": {
    name: "What a loss measures",
    lesson: "Lesson 2 · What a loss measures",
  },
};

type DiagQuestion = {
  id: string;
  topic: TopicId;
  kind: Kind;
  tag: string;
  text: string;
  choices?: Choice[];
  placeholder?: string;
  model?: string;
  ok: string;
  no: string;
};

const QUESTIONS: readonly DiagQuestion[] = [
  {
    id: "d1",
    topic: "gradient-intuition",
    kind: "mc",
    tag: "Question 1 · Gradient descent intuition",
    text: "Training loss falls for many steps, then — with nothing else changed — one step makes it jump up. What does that tell you?",
    choices: [
      { t: "The model has finished learning and should be stopped.", correct: false },
      { t: "That step overshot the valley — it was too long for this part of the slope.", correct: true },
      { t: "The training data contained an error.", correct: false },
    ],
    ok: "Right. A sudden rise after steady falling is the signature of a step that was too long for the local slope.",
    no: "A steady fall followed by a sudden rise is not the data or the finish line — it is one step landing on the far wall of the valley. That is what “needs work” points at here.",
  },
  {
    id: "d2",
    topic: "learning-rate",
    kind: "mc",
    tag: "Question 2 · The learning rate",
    text: "The loss jumps up right after a step. Which single change do you try first?",
    choices: [
      { t: "Add more layers to the network.", correct: false },
      { t: "Double the learning rate to get past the bump.", correct: false },
      { t: "Halve the learning rate and watch the next few steps.", correct: true },
    ],
    ok: "Yes. The learning rate scales every step; halving it is the cheap, reversible first move when steps overshoot.",
    no: "More layers or a bigger rate do not fix an overshooting step. Halving the learning rate is the first move — small, reversible, and aimed at the actual cause.",
  },
  {
    id: "d3",
    topic: "loss-meaning",
    kind: "recall",
    tag: "Question 3 · What a loss measures",
    text: "In one or two sentences: what does the loss measure, and why does training try to shrink it?",
    placeholder: "The loss measures…",
    model:
      "The loss measures how wrong the model’s predictions are, as a single number. Training shrinks it because a smaller loss means better predictions — it gives the optimizer one number to minimize.",
    ok: "Matches the instructor’s answer: the loss is how wrong the predictions are, as one number the optimizer can minimize.",
    no: "The instructor’s answer: the loss measures how wrong the predictions are, as a single number — shrinking it is what “learning” means here.",
  },
] as const;

const RETRY: Record<TopicId, { text: string; choices: Choice[] }> = {
  "gradient-intuition": {
    text: "One more try: the loss rises sharply right after a step. The most likely cause is…",
    choices: [
      { t: "The step overshot the valley — too long for the local slope.", correct: true },
      { t: "The model memorized the training data.", correct: false },
      { t: "The network has too many weights.", correct: false },
    ],
  },
  "learning-rate": {
    text: "One more try: when steps overshoot, the first change to try is…",
    choices: [
      { t: "Halve the learning rate.", correct: true },
      { t: "Double the learning rate.", correct: false },
      { t: "Train for twice as many steps.", correct: false },
    ],
  },
  "loss-meaning": {
    text: "One more try: the loss function turns…",
    choices: [
      { t: "“How wrong the predictions are” into a single number.", correct: true },
      { t: "The size of the network into a single number.", correct: false },
      { t: "The speed of training into a single number.", correct: false },
    ],
  },
};

const DIAG_LIST = ["Question 1 · Gradient descent", "Question 2 · Learning rate", "Question 3 · Loss"];

type QState = { selected: number; checked: boolean; correct: boolean; attempt: string };

type RetryState = {
  refresher: boolean;
  selected: number;
  correct: boolean;
  status: "none" | "wrong" | "ok";
};

function freshRetry(): RetryState {
  return { refresher: false, selected: -1, correct: false, status: "none" };
}

function focusSoon(el: React.RefObject<HTMLElement | null>) {
  window.setTimeout(() => el.current?.focus(), 0);
}

export function TestRecovery() {
  const [stage, setStage] = useState<"intro" | "quiz" | "results" | "done">("intro");
  const [qstate, setQstate] = useState<QState[]>(() =>
    QUESTIONS.map(() => ({ selected: -1, checked: false, correct: false, attempt: "" })),
  );
  const [qi, setQi] = useState(0);
  const [retry, setRetry] = useState<Partial<Record<TopicId, RetryState>>>({});
  const qTitleRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const q = QUESTIONS[qi];
  const s = qstate[qi];

  function updateQ(i: number, patch: Partial<QState>) {
    setQstate((prev) =>
      prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item)),
    );
  }

  function select(i: number) {
    if (s.checked) return;
    updateQ(qi, { selected: i });
  }

  function check() {
    if (s.checked) return;
    if (q.kind === "mc") {
      if (s.selected < 0) return;
      updateQ(qi, { checked: true, correct: q.choices?.[s.selected].correct ?? false });
    } else {
      const norm = s.attempt.toLowerCase();
      const correct =
        norm.includes("wrong") || norm.includes("error") || norm.includes("mistake");
      updateQ(qi, { checked: true, correct });
    }
  }

  function next() {
    if (qi < QUESTIONS.length - 1) {
      setQi(qi + 1);
      focusSoon(qTitleRef);
    } else {
      setStage("results");
    }
  }

  const needsWork = QUESTIONS.filter(
    (item, i) => qstate[i].checked && !qstate[i].correct,
  ).map((item) => item.topic);

  function updateRetry(topic: TopicId, patch: Partial<RetryState>) {
    setRetry((prev) => ({
      ...prev,
      [topic]: { ...freshRetry(), ...prev[topic], ...patch },
    }));
  }

  function checkRetry(topic: TopicId) {
    const st = retry[topic];
    if (!st || st.selected < 0 || st.correct) return;
    const correct = RETRY[topic].choices[st.selected].correct;
    if (correct) {
      updateRetry(topic, { correct: true, status: "ok" });
    } else {
      updateRetry(topic, { selected: -1, status: "wrong" });
    }
  }

  const allRecovered =
    needsWork.length > 0 &&
    needsWork.every((topic) => retry[topic]?.refresher && retry[topic]?.correct);

  function finishRecovery() {
    if (!allRecovered) return;
    setStage("done");
    focusSoon(doneRef);
  }

  const metaText =
    stage === "quiz"
      ? `Question ${qi + 1} of ${QUESTIONS.length}`
      : stage === "results"
        ? "Results"
        : stage === "done"
          ? "Recovery complete"
          : "Test & recovery";

  return (
    <div className={styles.narrow}>
      <div className={styles.pageHead}>
        <h1 className={styles.titleXl}>Check your understanding</h1>
        <p className={styles.sub}>
          A short diagnostic aimed at the topics this study has flagged as
          shaky. Three questions, then — only if something needs work — a
          small recovery plan you finish right here.
        </p>
        <span className={`${kit.metaText} ${styles.metaLine}`}>
          Test &amp; recovery · How neural networks learn · {metaText}
        </span>
      </div>

      <ol className={styles.miniList} aria-label="This diagnostic">
        {QUESTIONS.map((item, i) => {
          const state = qstate[i].checked
            ? qstate[i].correct
              ? "correct"
              : "missed"
            : i === qi && stage === "quiz"
              ? "current"
              : undefined;
          return (
            <li
              key={item.id}
              className={`${styles.miniItem} ${state ? styles[state] : ""}`}
            >
              <span className={styles.miniDot} aria-hidden="true" />
              <span>{DIAG_LIST[i]}</span>
            </li>
          );
        })}
      </ol>

      {stage === "intro" && (
        <section className={styles.qCard} aria-labelledby="tr-intro-h">
          <h2 id="tr-intro-h" className={styles.titleMd}>
            How this works
          </h2>
          <ul className={styles.introList}>
            <li>
              <span className={styles.miniDot} aria-hidden="true" />
              <span>
                Three questions targeting the study’s known weak spots:
                gradient descent intuition, the learning rate, and what a loss
                measures.
              </span>
            </li>
            <li>
              <span className={styles.miniDot} aria-hidden="true" />
              <span>
                No grades and no percentages. Each topic comes back as Solid
                or Needs work, in plain language.
              </span>
            </li>
            <li>
              <span className={styles.miniDot} aria-hidden="true" />
              <span>
                Anything that needs work gets a recovery step: a 4-minute
                refresher plus one retry question, checked off inline.
              </span>
            </li>
          </ul>
          <p className={styles.introHonest}>
            This is a sample diagnostic with prewritten content. Answers are
            checked against the instructor’s prewritten answers — nothing is
            generated live.
          </p>
          <button
            type="button"
            className={kit.btnPrimary}
            onClick={() => {
              setStage("quiz");
              focusSoon(qTitleRef);
            }}
          >
            Start the diagnostic
          </button>
        </section>
      )}

      {stage === "quiz" && (
        <section className={styles.qCard} aria-labelledby="tr-q-text">
          <span className={styles.qTag}>{q.tag}</span>
          <h2
            id="tr-q-text"
            ref={qTitleRef}
            tabIndex={-1}
            className={`${styles.titleLg} ${styles.qTitle}`}
          >
            {q.text}
          </h2>

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
                      name={`tr-answers-${q.id}`}
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

          {q.kind === "recall" && (
            <div className={styles.recallWrap}>
              <label className={styles.recallLabel} htmlFor="tr-recall">
                Your answer — write before you check
              </label>
              <textarea
                id="tr-recall"
                className={`${kit.textarea} ${styles.recallArea}`}
                placeholder={q.placeholder}
                value={s.attempt}
                disabled={s.checked}
                onChange={(e) => updateQ(qi, { attempt: e.target.value })}
              />
            </div>
          )}

          <div className={styles.qActions}>
            <div className={kit.btnRow}>
              {!s.checked && (
                <button
                  type="button"
                  className={kit.btnPrimary}
                  disabled={
                    q.kind === "mc" ? s.selected < 0 : s.attempt.trim().length === 0
                  }
                  onClick={check}
                >
                  Check answer
                </button>
              )}
              {s.checked && (
                <button type="button" className={kit.btnPrimary} onClick={next}>
                  {qi === QUESTIONS.length - 1 ? "See results" : "Next question"}
                </button>
              )}
            </div>
            <span className={styles.assistive}>
              {s.checked
                ? s.correct
                  ? "Solid — matches the instructor’s answer."
                  : "Needs work — the plan below targets exactly this."
                : "One attempt per question — this is a diagnostic, not a score."}
            </span>
          </div>

          {s.checked && (
            <div
              className={`${styles.feedback} ${
                s.correct ? styles.feedbackOk : styles.feedbackNo
              }`}
              aria-live="polite"
            >
              <span className={styles.fbTitle}>
                {s.correct ? "Solid." : "Needs work."}
              </span>
              <p>{s.correct ? q.ok : q.no}</p>
              <span className={styles.fbSrc}>
                Prewritten instructor feedback — this sample has no live AI.
              </span>
            </div>
          )}
        </section>
      )}

      {stage === "results" && (
        <section className={styles.qCard} aria-labelledby="tr-results-h">
          <h2 id="tr-results-h" className={styles.titleLg}>
            What the diagnostic found
          </h2>
          <p className={styles.planSub}>
            Per topic, in plain language. Solid means your answer matched the
            instructor’s; Needs work means it did not — a pointer for where to
            spend ten minutes, not a judgment.
          </p>
          <div className={styles.outcomeList}>
            {QUESTIONS.map((item, i) => {
              const ok = qstate[i].correct;
              return (
                <div className={styles.outcomeRow} key={item.id}>
                  <span className={styles.oName}>
                    {TOPICS[item.topic].name}
                    <span className={styles.oWhy}>
                      {ok
                        ? "Your answer matched the instructor’s — nothing to do here."
                        : "Your answer did not match the instructor’s — one refresher and one retry question below."}
                    </span>
                  </span>
                  {ok ? (
                    <span className={kit.pillSuccess}>
                      <span className={kit.dot} />
                      Solid
                    </span>
                  ) : (
                    <span className={kit.pillWarn}>
                      <span className={kit.dot} />
                      Needs work
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className={styles.meaningNote}>
            “Needs work” here means one thing only: this diagnostic’s answer
            suggests the idea is not solid yet. One refresher and one retry
            question usually close it — and the topic goes back into your
            normal review schedule afterward.
          </p>

          {needsWork.length === 0 ? (
            <div>
              <p className={styles.planSub}>
                No gaps found in this diagnostic. Nothing is added to your
                review schedule — the roadmap is the right next step.
              </p>
              <Link className={kit.btnPrimary} href="/roadmap" prefetch={false}>
                Continue to the roadmap
              </Link>
            </div>
          ) : (
            <div>
              <h3 className={styles.titleMd}>Recovery plan</h3>
              <p className={styles.planSub}>
                Work through each step inline. Check off the refresher once you
                have read it; the retry question checks itself.
              </p>
              <div className={styles.planSteps}>
                {needsWork.map((topic) => {
                  const st = retry[topic] ?? freshRetry();
                  const recovered = st.refresher && st.correct;
                  return (
                    <div
                      key={topic}
                      className={`${styles.planCard} ${
                        recovered ? styles.planCardDone : ""
                      }`}
                    >
                      <div className={styles.planCardTop}>
                        <h4 className={styles.titleCard}>{TOPICS[topic].name}</h4>
                        {recovered ? (
                          <span className={kit.pillSuccess}>
                            <span className={kit.dot} />
                            Recovered
                          </span>
                        ) : (
                          <span className={kit.pillWarn}>
                            <span className={kit.dot} />
                            Needs work
                          </span>
                        )}
                      </div>
                      <label className={styles.planCheck}>
                        <input
                          type="checkbox"
                          checked={st.refresher}
                          onChange={(e) =>
                            updateRetry(topic, { refresher: e.target.checked })
                          }
                          aria-label={`Mark refresher read for ${TOPICS[topic].name}`}
                        />
                        <span>
                          Refresher read
                          <span className={styles.pcNote}>
                            4 minutes · {TOPICS[topic].lesson}
                          </span>
                        </span>
                      </label>
                      <div className={styles.refresherRow}>
                        <span className={styles.rCopy}>
                          Read the refresher first — it is the same hillside
                          story, shorter.
                          <span className={styles.rMeta}>
                            Opens the course player in this study
                          </span>
                        </span>
                        <Link
                          className={kit.btnSecondary}
                          href="/course"
                          prefetch={false}
                        >
                          Open the 4-minute refresher
                        </Link>
                      </div>
                      <div className={styles.retryBlock}>
                        <p className={styles.retryQ}>{RETRY[topic].text}</p>
                        <div
                          className={styles.answers}
                          role="radiogroup"
                          aria-label="Retry answer choices"
                        >
                          {RETRY[topic].choices.map((c, i) => {
                            const isSelected = !st.correct && st.selected === i;
                            const rowCls =
                              st.correct && c.correct
                                ? `${kit.answerRowLocked} ${styles.rowCorrect} ${styles.rowWrap}`
                                : isSelected
                                  ? `${kit.answerRowSelected} ${styles.rowWrap}`
                                  : st.correct
                                    ? `${kit.answerRowLocked} ${styles.rowWrap}`
                                    : `${kit.answerRow} ${styles.rowWrap}`;
                            return (
                              <label key={c.t} className={rowCls}>
                                <input
                                  type="radio"
                                  className={styles.ansInput}
                                  name={`tr-retry-${topic}`}
                                  checked={st.correct ? c.correct : isSelected}
                                  disabled={st.correct}
                                  onChange={() =>
                                    updateRetry(topic, { selected: i })
                                  }
                                />
                                <span
                                  className={
                                    st.correct && c.correct
                                      ? `${styles.ansDot} ${styles.dotOk}`
                                      : styles.ansDot
                                  }
                                  aria-hidden="true"
                                />
                                <span>{c.t}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className={styles.retryFoot}>
                          <button
                            type="button"
                            className={kit.btnSecondary}
                            disabled={st.correct || st.selected < 0}
                            onClick={() => checkRetry(topic)}
                          >
                            {st.correct ? "Retry correct" : "Check retry"}
                          </button>
                          <span
                            className={`${styles.retryStatus} ${
                              st.status === "ok" ? styles.retryStatusOk : ""
                            }`}
                            aria-live="polite"
                          >
                            {st.status === "ok"
                              ? "Recovered — matches the instructor’s answer."
                              : st.status === "wrong"
                                ? "Not yet — reread the refresher, then pick again."
                                : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.finishRow}>
                <span className={styles.finishNote}>
                  {allRecovered
                    ? "All recovery steps done."
                    : "Finish every step to complete recovery — refresher read plus a correct retry for each topic."}
                </span>
                <button
                  type="button"
                  className={kit.btnPrimary}
                  disabled={!allRecovered}
                  onClick={finishRecovery}
                >
                  Finish recovery
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {stage === "done" && (
        <section className={styles.qCard} aria-labelledby="tr-done-h">
          <h2 id="tr-done-h" ref={doneRef} tabIndex={-1} className={styles.titleLg}>
            Recovery complete
          </h2>
          <p className={styles.bodyText}>
            You worked through every recovery step. Recovered topics go back
            into your review schedule — they will come up again in the review
            inbox at a normal interval, so this sticks past today.
          </p>
          <p className={styles.honestNote}>
            Sample prototype: this recovery is recorded for this session only.
            In the full product it would update the review inbox and the
            progress evidence.
          </p>
          <div className={styles.sActions}>
            <Link className={kit.btnPrimary} href="/review" prefetch={false}>
              Open review inbox
            </Link>
            <Link className={kit.btnSecondary} href="/roadmap" prefetch={false}>
              Back to the roadmap
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

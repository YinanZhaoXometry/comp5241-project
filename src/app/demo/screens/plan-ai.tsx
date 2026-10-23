"use client";

// New study — Goal & plan, AI-assisted variant (sample port of
// temp/new-study-plan-ai.html). A clearly-labeled drafted plan the learner
// reviews: editable titles/minutes/checkpoints, removable with undo, and
// accept-as-mine semantics. The draft is prewritten sample content — no AI
// runs here — and all state is memory-only.

import { useRef, useState } from "react";
import Link from "next/link";
import kit from "../../kit.module.css";
import css from "./recall-screens.module.css";

type Lesson = {
  id: string;
  title: string;
  minutes: string;
  source: string;
  rationale?: string;
};

type Checkpoint = { id: string; text: string };

type Undo = { kind: "lesson"; item: Lesson; index: number } | { kind: "check"; item: Checkpoint; index: number };

const DEFAULT_AI_GOAL =
  "I want to understand how neural networks learn, well enough to explain backpropagation to a colleague";
const DEFAULT_MANUAL_GOAL =
  "Explain how a neural network learns from examples, and walk through one gradient-descent step by hand.";

const AI_CHIPS: readonly { label: string; goal: string }[] = [
  {
    label: "Explain backpropagation to a colleague.",
    goal: "I want to understand how neural networks learn, well enough to explain backpropagation to a colleague",
  },
  {
    label: "Walk one gradient-descent step by hand.",
    goal: "I want to walk through one gradient-descent step by hand, end to end, without notes.",
  },
  {
    label: "Diagnose an oscillating training loss.",
    goal: "I want to diagnose why a training loss oscillates instead of falling, and know what to try first.",
  },
];

const MANUAL_CHIPS: readonly { label: string; goal: string }[] = [
  { label: "Explain backpropagation to a colleague without jargon.", goal: "Explain backpropagation to a colleague without jargon." },
  { label: "Walk through one gradient-descent step by hand, end to end.", goal: "Walk through one gradient-descent step by hand, end to end." },
  { label: "Diagnose why a training loss oscillates instead of falling.", goal: "Diagnose why a training loss oscillates instead of falling." },
];

const AI_LESSONS: readonly Lesson[] = [
  {
    id: "ai-1",
    title: "What a neural network is — neurons, weights, layers",
    minutes: "15",
    source: "Source: Lecture Notes, pp. 3–8",
    rationale: "Gives you the shared vocabulary you need before any learning can be explained.",
  },
  {
    id: "ai-2",
    title: "What a loss measures — one number for how wrong we are",
    minutes: "12",
    source: "Source: Lecture Notes, pp. 9–14",
    rationale: 'Backpropagation only makes sense once "getting less wrong" is a concrete quantity.',
  },
  {
    id: "ai-3",
    title: "Gradient descent — the hillside walk, step by step",
    minutes: "20",
    source: "Source: gradient-descent-walkthrough.md",
    rationale: "The core mechanic your colleague will ask about first: how weights actually move.",
  },
  {
    id: "ai-4",
    title: "Backpropagation — assigning blame with the chain rule",
    minutes: "18",
    source: "Source: Lecture Notes, pp. 15–21",
    rationale: "Ties the first three lessons together into the plain-language explanation you asked for.",
  },
];

const AI_CHECKS: readonly Checkpoint[] = [
  {
    id: "check-1",
    text: "Explain in two sentences what a weight is and what changing it does",
  },
  {
    id: "check-2",
    text: "Walk through one gradient-descent step on a tiny two-weight example",
  },
  {
    id: "check-3",
    text: "Explain backpropagation to a colleague in plain language, from memory",
  },
];

const MANUAL_LESSONS: readonly Lesson[] = [
  {
    id: "m-1",
    title: "What a neural network is — neurons, weights, layers",
    minutes: "15",
    source: "Source: Lecture Notes, pp. 3–8",
  },
  {
    id: "m-2",
    title: "What a loss measures — one number for how wrong we are",
    minutes: "12",
    source: "Source: Lecture Notes, pp. 9–14",
  },
  {
    id: "m-3",
    title: "Gradient descent — the hillside walk, step by step",
    minutes: "20",
    source: "Source: gradient-descent-walkthrough.md",
  },
];

const MAX_GOAL = 280;

export function PlanAi() {
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [aiGoal, setAiGoal] = useState(DEFAULT_AI_GOAL);
  const [manualGoal, setManualGoal] = useState(DEFAULT_MANUAL_GOAL);
  const [drafted, setDrafted] = useState(false);
  const [studyTitle, setStudyTitle] = useState("How neural networks learn");
  const [aiLessons, setAiLessons] = useState<Lesson[]>(AI_LESSONS.slice());
  const [aiChecks, setAiChecks] = useState<Checkpoint[]>(AI_CHECKS.slice());
  const [manualLessons, setManualLessons] = useState<Lesson[]>(MANUAL_LESSONS.slice());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [accepted, setAccepted] = useState(false);

  const aiGoalRef = useRef<HTMLTextAreaElement | null>(null);
  const manualGoalRef = useRef<HTMLTextAreaElement | null>(null);
  const draftPanelRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(1);
  const pendingFocusRef = useRef<string | null>(null);

  const draftPlan = () => {
    setDrafted(true);
    // The reference scrolls the freshly drafted plan into view.
    window.setTimeout(() => draftPanelRef.current?.scrollIntoView({ block: "nearest" }), 0);
  };

  const removeAi = (item: Undo) => {
    setUndo(item);
    if (item.kind === "lesson") {
      setAiLessons(prev => prev.filter(lesson => lesson.id !== item.item.id));
    } else {
      setAiChecks(prev => prev.filter(check => check.id !== item.item.id));
    }
  };

  const undoRemove = () => {
    if (!undo) return;
    if (undo.kind === "lesson") {
      setAiLessons(prev => {
        const next = prev.slice();
        next.splice(Math.min(undo.index, next.length), 0, undo.item);
        return next;
      });
    } else {
      setAiChecks(prev => {
        const next = prev.slice();
        next.splice(Math.min(undo.index, next.length), 0, undo.item);
        return next;
      });
    }
    setUndo(null);
  };

  const addManualLesson = () => {
    const id = `new-${nextIdRef.current}`;
    nextIdRef.current += 1;
    pendingFocusRef.current = id;
    setManualLessons(prev => [
      ...prev,
      { id, title: "", minutes: "15", source: "Source: pick from your uploaded files" },
    ]);
  };

  return (
    <div className={`${css.screen} ${css.w820}`}>
      <div>
        <h1 className={css.pageH1}>New study — Goal &amp; plan</h1>
        <p className={css.sub}>
          Describe your goal and let the AI draft a plan from your materials, or write it yourself.
          Either way, every line stays editable before and after you accept.
        </p>
      </div>

      <p className={css.steps} aria-label="Steps">
        <span>01 Materials</span>
        <span className={css.stepSep} aria-hidden="true">
          ·
        </span>
        <span className={css.stepOn}>02 Goal &amp; plan</span>
        <span className={css.stepSep} aria-hidden="true">
          ·
        </span>
        <span>03 Privacy &amp; data</span>
      </p>

      <fieldset className={css.seg}>
        <legend className={css.srOnly}>Plan editing mode</legend>
        <button
          type="button"
          className={`${css.segBtn} ${mode === "manual" ? css.segBtnOn : ""}`}
          aria-pressed={mode === "manual"}
          onClick={() => setMode("manual")}
        >
          Manual
        </button>
        <button
          type="button"
          className={`${css.segBtn} ${mode === "ai" ? css.segBtnOn : ""}`}
          aria-pressed={mode === "ai"}
          onClick={() => setMode("ai")}
        >
          AI-assisted
        </button>
      </fieldset>

      {mode === "ai" ? (
        <div className={css.planGrid}>
          <section className={css.panel} aria-labelledby="ai-goal-h">
            <h2 id="ai-goal-h" className={css.panelH2}>
              Your goal
            </h2>
            <p className={css.panelSub}>
              Describe what you want to understand or be able to do. The AI drafts a plan from this
              and your uploaded materials.
            </p>
            <div>
              <label className={css.recallLabel} htmlFor="ai-goal-input">
                Goal
              </label>
              <textarea
                id="ai-goal-input"
                ref={aiGoalRef}
                className={kit.textarea}
                maxLength={MAX_GOAL}
                value={aiGoal}
                placeholder="Example: I want to understand how neural networks learn, well enough to explain backpropagation to a colleague."
                onChange={e => setAiGoal(e.target.value)}
              />
              <p className={css.goalCount}>
                <span className={kit.num}>{aiGoal.length}</span> / <span className={kit.num}>{MAX_GOAL}</span>
              </p>
            </div>
            <button type="button" className={kit.btnSecondary} onClick={draftPlan}>
              Draft a plan
            </button>
            <div className={css.chips}>
              <p className={css.chipsLabel}>Need a starting point?</p>
              {AI_CHIPS.map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  className={css.chip}
                  onClick={() => {
                    setAiGoal(chip.goal);
                    aiGoalRef.current?.focus();
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </section>

          <section className={css.panel} aria-labelledby="ai-draft-h">
            <div ref={draftPanelRef}>
              <h2 id="ai-draft-h" className={css.panelH2}>
                Drafted plan
              </h2>
              <p className={css.panelSub}>
                Nothing is saved until you accept. Edit titles, minutes, and checkpoints freely — the
                draft is a starting point, not a decision.
              </p>

              <div className={css.neutralNotice} role="note">
                <p>
                  In the real product this draft comes from the AI model; here it is prewritten
                  sample content.
                </p>
              </div>

              {!drafted ? (
                <p className={css.draftEmptyText}>
                  No draft yet. Write your goal on the left, then choose &quot;Draft a plan&quot;.
                </p>
              ) : (
                <div>
                  <div className={css.draftBanner}>
                    <span className={kit.pillMuted}>
                      <span className={kit.dot} />
                      Drafted from your goal — review before accepting
                    </span>
                  </div>

                  <div className={css.titleField}>
                    <label className={css.titleLabel} htmlFor="study-title">
                      Suggested study title
                    </label>
                    <input
                      id="study-title"
                      className={css.titleInput}
                      type="text"
                      value={studyTitle}
                      onChange={e => setStudyTitle(e.target.value)}
                    />
                  </div>

                  <p className={css.subhead} id="lessons-subhead">
                    Proposed lessons
                  </p>
                  <div className={css.lessonList} aria-labelledby="lessons-subhead">
                    {aiLessons.map((lesson, index) => (
                      <div className={css.lessonRow} key={lesson.id}>
                        <span className={css.lessonNum} aria-hidden="true">
                          {index + 1}
                        </span>
                        <div className={css.lessonMain}>
                          <input
                            className={css.lessonTitleInput}
                            type="text"
                            value={lesson.title}
                            aria-label={`Lesson ${index + 1} title`}
                            onChange={e =>
                              setAiLessons(prev =>
                                prev.map(l => (l.id === lesson.id ? { ...l, title: e.target.value } : l)),
                              )
                            }
                          />
                          {lesson.rationale !== undefined && (
                            <p className={css.rationale}>{lesson.rationale}</p>
                          )}
                          <div className={css.lessonSub}>
                            <span className={css.lessonMin}>
                              <input
                                className={css.minInput}
                                type="number"
                                min={1}
                                max={180}
                                value={lesson.minutes}
                                aria-label={`Lesson ${index + 1} estimated minutes`}
                                onChange={e =>
                                  setAiLessons(prev =>
                                    prev.map(l =>
                                      l.id === lesson.id ? { ...l, minutes: e.target.value } : l,
                                    ),
                                  )
                                }
                              />{" "}
                              min
                            </span>
                            <span className={css.lessonCov}>{lesson.source}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className={css.lessonRemove}
                          aria-label={`Remove lesson ${index + 1}`}
                          onClick={() =>
                            removeAi({ kind: "lesson", item: lesson, index })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <p className={css.subhead} id="checks-subhead">
                    Proposed practice checkpoints
                  </p>
                  <div className={css.checkList} aria-labelledby="checks-subhead">
                    {aiChecks.map((check, index) => (
                      <div className={css.checkRow} key={check.id}>
                        <div className={css.checkMain}>
                          <input
                            className={css.lessonTitleInput}
                            type="text"
                            value={check.text}
                            aria-label={`Checkpoint ${index + 1} text`}
                            onChange={e =>
                              setAiChecks(prev =>
                                prev.map(c => (c.id === check.id ? { ...c, text: e.target.value } : c)),
                              )
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className={css.lessonRemove}
                          aria-label={`Remove checkpoint ${index + 1}`}
                          onClick={() => removeAi({ kind: "check", item: check, index })}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <output className={css.undoBar} hidden={!undo}>
                    <span>{undo ? `${undo.kind === "lesson" ? "Lesson" : "Checkpoint"} removed.` : ""}</span>
                    <button type="button" className={css.undoBtn} onClick={undoRemove}>
                      Undo
                    </button>
                  </output>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className={css.planGrid}>
          <section className={css.panel} aria-labelledby="goal-h">
            <h2 id="goal-h" className={css.panelH2}>
              Your goal
            </h2>
            <p className={css.panelSub}>What do you want to be able to explain or do?</p>
            <div>
              <label className={css.recallLabel} htmlFor="goal-input">
                Goal
              </label>
              <textarea
                id="goal-input"
                ref={manualGoalRef}
                className={kit.textarea}
                maxLength={MAX_GOAL}
                value={manualGoal}
                placeholder="Example: Explain how gradient descent fits a neural network to data, in plain language."
                onChange={e => setManualGoal(e.target.value)}
              />
              <p className={css.goalCount}>
                <span className={kit.num}>{manualGoal.length}</span> /{" "}
                <span className={kit.num}>{MAX_GOAL}</span>
              </p>
            </div>
            <div className={css.chips}>
              <p className={css.chipsLabel}>Need a starting point?</p>
              {MANUAL_CHIPS.map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  className={css.chip}
                  onClick={() => {
                    setManualGoal(chip.goal);
                    manualGoalRef.current?.focus();
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </section>

          <section className={css.panel} aria-labelledby="plan-h">
            <h2 id="plan-h" className={css.panelH2}>
              Plan outline
            </h2>
            <p className={css.panelSub}>
              Edit, reorder by rewriting, or remove lessons. Minutes are estimates — you can change
              them later.
            </p>
            <div className={css.lessonList}>
              {manualLessons.map((lesson, index) => (
                <div className={css.lessonRow} key={lesson.id}>
                  <span className={css.lessonNum} aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className={css.lessonMain}>
                    <input
                      className={css.lessonTitleInput}
                      type="text"
                      value={lesson.title}
                      placeholder="Lesson title"
                      aria-label={`Lesson ${index + 1} title`}
                      onChange={e =>
                        setManualLessons(prev =>
                          prev.map(l => (l.id === lesson.id ? { ...l, title: e.target.value } : l)),
                        )
                      }
                      ref={el => {
                        if (el && pendingFocusRef.current === lesson.id) {
                          pendingFocusRef.current = null;
                          el.focus();
                        }
                      }}
                    />
                    <div className={css.lessonSub}>
                      <span className={css.lessonMin}>
                        <input
                          className={css.minInput}
                          type="number"
                          min={1}
                          max={180}
                          value={lesson.minutes}
                          aria-label={`Lesson ${index + 1} estimated minutes`}
                          onChange={e =>
                            setManualLessons(prev =>
                              prev.map(l =>
                                l.id === lesson.id ? { ...l, minutes: e.target.value } : l,
                              ),
                            )
                          }
                        />{" "}
                        min
                      </span>
                      <span className={css.lessonCov}>{lesson.source}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={css.lessonRemove}
                    aria-label={`Remove lesson ${index + 1}`}
                    onClick={() => setManualLessons(prev => prev.filter(l => l.id !== lesson.id))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className={`${kit.btnSecondary} ${css.addLesson}`} onClick={addManualLesson}>
              + Add a lesson
            </button>
          </section>
        </div>
      )}

      <div className={css.flowFoot}>
        <span className={css.hintText}>
          {accepted
            ? "Saved. In the real product you would continue to privacy & data next."
            : "Accepting saves this as your plan; you can edit everything afterward."}
        </span>
        <div className={css.flowRight}>
          <output className={css.savedNote} hidden={!accepted}>
            <span className={css.tick} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            Plan saved as a draft — everything stays editable.
          </output>
          <Link className={kit.btnQuiet} href="/demo" prefetch={false}>
            ← Back
          </Link>
          <button
            type="button"
            className={kit.btnPrimary}
            onClick={() => setAccepted(true)}
            disabled={accepted}
          >
            Accept plan
          </button>
        </div>
      </div>
    </div>
  );
}

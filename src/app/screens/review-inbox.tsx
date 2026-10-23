"use client";

// Review inbox — spaced-review queue (sample port of temp/review-inbox.html).
// Working due/scheduled/paused/done views, write-before-you-peek recall with
// instructor-written notes, honest self-assessment rescheduling, and a real
// empty state. All state is memory-only and resets on reload.

import { useState } from "react";
import kit from "../kit.module.css";
import css from "./recall-screens.module.css";

type DueStatus = "due" | "done" | "paused";

type CardState = {
  status: DueStatus;
  open: boolean;
  noteShown: boolean;
  fuzzy: boolean;
};

type DueCard = {
  id: string;
  title: string;
  missed: boolean;
  pillText: string;
  why: string;
  srcBase: string;
  lastAttempt: string;
  prompt: string;
  note: string;
  doneText: string;
};

const DUE_CARDS: readonly DueCard[] = [
  {
    id: "learning-rate",
    title: "Why learning rates matter",
    missed: true,
    pillText: "Missed in practice · 2 days ago",
    why: "You missed this in yesterday's practice session, so it moved to the front of the queue.",
    srcBase: "Lesson 3 · Gradient descent, step by step",
    lastAttempt: "missed",
    prompt:
      "In your own words: what does the learning rate control in gradient descent, and what goes wrong when it is set too high?",
    note: "The learning rate scales each step down the loss slope. Too high, and every step overshoots the minimum — the loss bounces around instead of settling. Too low, and training crawls. The skill is reading the training curve to tell the two apart.",
    doneText:
      "Logged as recalled — next review in 4 days. The interval doubled because this is your second success in a row.",
  },
  {
    id: "gradient-descent",
    title: "Gradient descent, step by step",
    missed: false,
    pillText: "Recall due · last recalled 6 days ago",
    why: "Your last successful recall was 6 days ago — the interval says it is time to check again.",
    srcBase: "Lesson 3 · Gradient descent, step by step",
    lastAttempt: "recalled",
    prompt: "Walk through one step of gradient descent: what do you compute, and in what order?",
    note: "Compute the loss on the current weights, take its gradient — the direction the loss increases — then move the weights a small step against that direction. Repeat until the steps stop helping.",
    doneText: "Logged as recalled — next review in 6 days.",
  },
  {
    id: "loss",
    title: "What a loss measures",
    missed: true,
    pillText: "Missed in practice · 3 days ago",
    why: "Missed once in practice — one more look while it is still fresh is worth more than re-reading the lesson.",
    srcBase: "Lesson 2 · What a loss measures",
    lastAttempt: "partly recalled",
    prompt:
      "A model's loss is 0.02 on its training data but 0.41 on new data. What is the loss telling you in each case?",
    note: "Loss is the size of the model's error. Low training loss with high new-data loss means the model memorized the examples instead of learning the pattern — that gap is overfitting, and lesson 4 is about seeing it coming.",
    doneText:
      "Logged as recalled — next review in 2 days. Short interval, because this one was missed recently.",
  },
];

const SCHEDULED: readonly { name: string; why: string; when: string }[] = [
  {
    name: "What a neuron computes",
    why: "Interval doubled after two successful recalls in a row",
    when: "In 2 days",
  },
  {
    name: "Activation functions, briefly",
    why: "First repeat interval after one successful recall",
    when: "In 4 days",
  },
  {
    name: "Loss versus accuracy",
    why: "Scheduled from your last practice session",
    when: "In 5 days",
  },
  {
    name: "Batches and epochs",
    why: "Interval held steady — last recall was hesitant",
    when: "In 8 days",
  },
  {
    name: "What a single perceptron cannot learn",
    why: "Longest interval in this study — three successful recalls",
    when: "In 9 days",
  },
];

const PAUSED: readonly { title: string; pill: string; src: string }[] = [
  {
    title: "Backpropagation, the long version",
    pill: "Paused 5 days ago",
    src: "Lesson 3 · optional depth material · Paused by you",
  },
  {
    title: "A brief history of neural nets",
    pill: "Paused 2 weeks ago",
    src: "Lesson 1 · background reading · Paused by you",
  },
];

const FUZZY_WHY =
  "Marked as still fuzzy — this stays due, and we will ask again tomorrow at a short interval.";
const PAUSED_DONE_TEXT =
  "Paused — it will not be scheduled, and it does not count as a gap. You can resume it from the paused tab.";
const SCHEDULED_COUNT = 5;
const PAUSED_COUNT = 2;

function initialCards(): Record<string, CardState> {
  const out: Record<string, CardState> = {};
  for (const card of DUE_CARDS) {
    out[card.id] = { status: "due", open: false, noteShown: false, fuzzy: false };
  }
  return out;
}

export function ReviewInbox() {
  const [view, setView] = useState<"due" | "scheduled" | "paused" | "done">("due");
  const [cards, setCards] = useState<Record<string, CardState>>(initialCards);

  const patchCard = (id: string, patch: Partial<CardState>) =>
    setCards(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Opening one recall closes the others, like the reference accordion.
  const toggleOpen = (id: string) =>
    setCards(prev => {
      const opening = !prev[id].open;
      const next: Record<string, CardState> = {};
      for (const key of Object.keys(prev)) {
        next[key] = { ...prev[key], open: opening && key === id };
      }
      return next;
    });

  const remainingDue = DUE_CARDS.filter(card => cards[card.id].status === "due");
  const doneList = DUE_CARDS.filter(card => cards[card.id].status === "done");
  const tabs: readonly { id: "due" | "scheduled" | "paused" | "done"; label: string; count: number }[] = [
    { id: "due", label: "Due now", count: remainingDue.length },
    { id: "scheduled", label: "Scheduled", count: SCHEDULED_COUNT },
    { id: "paused", label: "Paused", count: PAUSED_COUNT },
    { id: "done", label: "Done this week", count: doneList.length },
  ];

  return (
    <div className={`${css.screen} ${css.w960}`}>
      <div>
        <h1 className={css.pageH1}>Review inbox</h1>
        <p className={css.sub}>
          Everything here earned its place: a missed practice question, or a recall whose interval is
          up. Nothing is scheduled to keep you busy — only to keep memory from fading.
        </p>
      </div>

      <output className={css.summary}>
        <span className={css.sum}>
          <span className={css.sumNum}>{remainingDue.length}</span>
          <span className={css.sumLabel}>due now</span>
        </span>
        <span className={css.sum}>
          <span className={css.sumNum}>{SCHEDULED_COUNT}</span>
          <span className={css.sumLabel}>scheduled</span>
        </span>
        <span className={css.sum}>
          <span className={css.sumNum}>{PAUSED_COUNT}</span>
          <span className={css.sumLabel}>paused</span>
        </span>
        <span className={css.sumNote}>
          Intervals are estimates from your own recall history — they shift if you review early or
          late.
        </span>
      </output>

      <fieldset className={css.seg}>
        <legend className={css.srOnly}>Inbox views</legend>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${css.segBtn} ${view === tab.id ? css.segBtnOn : ""}`}
            aria-pressed={view === tab.id}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
            <span className={css.segCnt}>{tab.count}</span>
          </button>
        ))}
      </fieldset>

      {view === "due" && (
        <div className={css.queue}>
          {DUE_CARDS.map(card => {
            const state = cards[card.id];
            const why = state.fuzzy ? FUZZY_WHY : card.why;
            const attempt = state.fuzzy ? "still fuzzy" : card.lastAttempt;
            return (
              <article className={css.revCard} key={card.id}>
                <div className={css.revTop}>
                  <h2 className={css.revTitle}>{card.title}</h2>
                  {state.status === "due" &&
                    (card.missed ? (
                      <span className={css.pillMissed}>
                        <span className={css.dot} />
                        {card.pillText}
                      </span>
                    ) : (
                      <span className={kit.pillMuted}>
                        <span className={kit.dot} />
                        {card.pillText}
                      </span>
                    ))}
                </div>
                {state.status === "due" ? (
                  <>
                    <p className={css.revWhy}>{why}</p>
                    <p className={css.revSrc}>
                      {card.srcBase} · Last attempt: {attempt}
                    </p>
                    <div className={css.revActions}>
                      <button
                        type="button"
                        className={card.id === "learning-rate" ? kit.btnPrimary : kit.btnSecondary}
                        aria-expanded={state.open}
                        aria-controls={`${card.id}-recall`}
                        onClick={() => toggleOpen(card.id)}
                      >
                        Review now
                      </button>
                      <button
                        type="button"
                        className={kit.btnQuiet}
                        onClick={() => patchCard(card.id, { status: "paused", open: false })}
                      >
                        Pause this topic
                      </button>
                    </div>
                    <div className={css.recall} id={`${card.id}-recall`} hidden={!state.open}>
                      <p className={css.recallPrompt}>{card.prompt}</p>
                      <label className={css.recallLabel} htmlFor={`${card.id}-text`}>
                        Your recall — write before you peek
                      </label>
                      <textarea
                        id={`${card.id}-text`}
                        className={kit.textarea}
                        placeholder="Type what you remember, even roughly. Comparing it to the note is where the learning happens."
                      />
                      <div className={css.recallFoot}>
                        <button
                          type="button"
                          className={kit.btnSecondary}
                          disabled={state.noteShown}
                          onClick={() => patchCard(card.id, { noteShown: true })}
                        >
                          {state.noteShown ? "Instructor's note shown" : "Show the instructor's note"}
                        </button>
                        <span className={css.metaTxt}>
                          Written by your instructor — not generated on the fly
                        </span>
                      </div>
                      {state.noteShown && (
                        <div className={css.recallNote} role="note">
                          <span className={css.noteLabel}>Instructor&apos;s note</span>
                          {card.note}
                        </div>
                      )}
                      <div className={css.recallFoot}>
                        <span className={css.selfLabel}>Compared to the note, how did you do?</span>
                        <div className={css.selfAssess} hidden={!state.noteShown}>
                          <button
                            type="button"
                            className={kit.btnSecondary}
                            onClick={() => patchCard(card.id, { status: "done", open: false })}
                          >
                            I recalled it
                          </button>
                          <button
                            type="button"
                            className={kit.btnQuiet}
                            onClick={() =>
                              patchCard(card.id, { open: false, noteShown: false, fuzzy: true })
                            }
                          >
                            Still fuzzy
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <output className={css.doneNote}>
                    {state.status === "done" ? (
                      <>
                        <span className={kit.pillSuccess}>
                          <span className={kit.dot} />
                          Reviewed
                        </span>
                        {card.doneText}
                      </>
                    ) : (
                      <>
                        <span className={kit.pillMuted}>
                          <span className={kit.dot} />
                          Paused
                        </span>
                        {PAUSED_DONE_TEXT}
                      </>
                    )}
                  </output>
                )}
              </article>
            );
          })}
          {remainingDue.length === 0 && (
            <div className={kit.empty}>
              <h3 className={css.emptyH3}>Inbox clear</h3>
              <p className={css.emptyP}>
                Nothing is due right now. The next scheduled review arrives tomorrow — this screen
                will not invent work to fill the gap.
              </p>
            </div>
          )}
        </div>
      )}

      {view === "scheduled" && (
        <div className={css.queue}>
          {SCHEDULED.map(item => (
            <div className={css.schedRow} key={item.name}>
              <span className={css.schedName}>
                {item.name}
                <span className={css.schedWhy}>{item.why}</span>
              </span>
              <span className={css.schedWhen}>
                <span className={css.schedDate}>{item.when}</span>
                <button type="button" className={kit.btnQuiet}>
                  Review early
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {view === "paused" && (
        <div className={css.queue}>
          <p className={css.pausedNote}>
            Paused topics are not scheduled and do not count as gaps. Resuming one puts it back in
            tomorrow&apos;s queue at a short interval.
          </p>
          {PAUSED.map(item => (
            <article className={css.revCard} key={item.title}>
              <div className={css.revTop}>
                <h2 className={css.revTitle}>{item.title}</h2>
                <span className={kit.pillMuted}>
                  <span className={kit.dot} />
                  {item.pill}
                </span>
              </div>
              <p className={css.revSrc}>{item.src}</p>
              <div className={css.revActions}>
                <button type="button" className={kit.btnSecondary}>
                  Resume this topic
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {view === "done" &&
        (doneList.length === 0 ? (
          <div className={kit.empty}>
            <h3 className={css.emptyH3}>Nothing reviewed this week yet</h3>
            <p className={css.emptyP}>
              Reviews you finish land here with their next interval. An empty week is a fact, not a
              failure — the scheduled tab shows what is coming.
            </p>
          </div>
        ) : (
          <div className={css.queue}>
            {doneList.map(card => (
              <article className={css.revCard} key={card.id}>
                <h2 className={css.revTitle}>{card.title}</h2>
                <p className={css.doneNote}>
                  <span className={kit.pillSuccess}>
                    <span className={kit.dot} />
                    Reviewed
                  </span>
                  {card.doneText}
                </p>
              </article>
            ))}
          </div>
        ))}
    </div>
  );
}

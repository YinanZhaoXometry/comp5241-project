"use client";

// Why explorer — honest "why" answers about the study design (sample port of
// temp/why-explorer.html). Working single-open accordion (button + aria-
// expanded + region) plus the trace-your-path strip. Memory-only state.

import { Fragment, useState } from "react";
import Link from "next/link";
import kit from "../../kit.module.css";
import css from "./recall-screens.module.css";

type QAItem = {
  id: string;
  q: string;
  paras: readonly string[];
  detail: string;
};

const QA_ITEMS: readonly QAItem[] = [
  {
    id: "order",
    q: "Why this order?",
    paras: [
      "Each lesson here depends on the one before it. You can't follow gradient descent until a loss means something to you, and backpropagation is just gradient descent applied carefully, layer by layer. So the order is perceptron, then loss, then gradient descent, then backpropagation.",
      "Later lessons don't unlock by time spent — they unlock when the earlier idea has been practiced once. If the order feels slow, that is the dependency chain showing, not a judgment about you.",
    ],
    detail:
      "Supporting detail: the dependency chain was set by the instructor who wrote this sample study, not inferred by the AI. The AI drafted explanations inside that order.",
  },
  {
    id: "practice",
    q: "Why practice so early?",
    paras: [
      "Practice appears before you feel ready on purpose. Pulling an answer out of memory — even clumsily, even wrong — is what builds the memory. Re-reading a lesson feels productive and mostly isn't.",
      "Early practice is also how the study finds out what you actually took away, so review later is aimed at real gaps instead of guessed ones. Missed questions are routed to your review inbox, not scored against you.",
    ],
    detail:
      "Supporting detail: practice answers in this sample come with prewritten feedback from the instructor. Nothing is graded, and misses carry no penalty.",
  },
  {
    id: "review",
    q: "Why does review come back later?",
    paras: [
      "Memory fades on a curve, and recalling something just as it starts to fade strengthens it more than recalling it while it's fresh. So reviews come back after a gap — days, not minutes — and the gap grows each time you recall successfully.",
      "That is why a topic you already know still shows up in the review inbox. It isn't the study doubting you; it's the spacing doing its work.",
    ],
    detail:
      "Supporting detail: the intervals are estimates from your own recall history in this sample — they double after each success and shorten after a miss. They are rough on purpose and shift if you review early or late.",
  },
  {
    id: "scores",
    q: "Why no scores or grades?",
    paras: [
      "A score would measure how you did on one attempt, on one day. What this study tracks instead is evidence: what you can reproduce without notes, and how often it has held up across spaced recalls.",
      "There are no streaks, points, or leaderboards either. The record on your progress screen is meant to be believed, and numbers designed to keep you coming back are hard to believe.",
    ],
    detail:
      'Supporting detail: practice session meters in this sample are labeled "session only — not a stored score." Nothing from a single session is saved as a judgment.',
  },
];

const LOOP_STEPS: readonly { num: string; title: string; text: string; current: boolean }[] = [
  {
    num: "You are here",
    title: "Lesson",
    text: "Gradient descent, step by step — read, worked example, one simulation.",
    current: true,
  },
  {
    num: "Next",
    title: "Practice",
    text: "Three short questions on this lesson. Misses go to the review inbox.",
    current: false,
  },
  {
    num: "In a few days",
    title: "Review",
    text: "One recall prompt, spaced by an interval estimated from your history.",
    current: false,
  },
  {
    num: "Over time",
    title: "Progress",
    text: "Successful recalls become evidence on your progress screen.",
    current: false,
  },
];

export function WhyExplorer() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className={`${css.screen} ${css.w880}`}>
      <div className={css.whyHead}>
        <h1 className={css.pageH1}>Why this study works this way</h1>
        <p className={css.sub}>
          Fair questions deserve straight answers. Here is the reasoning behind the order, the early
          practice, and the reviews that come back later.
        </p>
        <p className={css.notePlate}>
          These explanations are about how this sample study is put together. They are not claims
          about how everyone learns best.
        </p>
      </div>

      <div className={css.qaList}>
        {QA_ITEMS.map(item => {
          const expanded = open === item.id;
          return (
            <div className={`${css.qa} ${expanded ? css.qaOpen : ""}`} key={item.id}>
              <button
                type="button"
                className={css.qaHead}
                aria-expanded={expanded}
                aria-controls={`qa-body-${item.id}`}
                id={`qa-head-${item.id}`}
                onClick={() => setOpen(expanded ? null : item.id)}
              >
                {item.q}
                <svg
                  className={css.chev}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <section
                className={css.qaBody}
                id={`qa-body-${item.id}`}
                aria-labelledby={`qa-head-${item.id}`}
                hidden={!expanded}
              >
                {item.paras.map((para, index) => (
                  <p className={css.qaP} key={index}>
                    {para}
                  </p>
                ))}
                <p className={css.qaDetail}>{item.detail}</p>
              </section>
            </div>
          );
        })}
      </div>

      <section className={css.pathSection}>
        <h2 className={css.pathH2}>Trace your path</h2>
        <p className={css.pathSub}>
          Where lesson 3 sits in the loop — what feeds it, and what it feeds. You are at the lesson
          step now.
        </p>
        <div className={css.loop}>
          {LOOP_STEPS.map((step, index) => (
            <Fragment key={step.title}>
              {index > 0 && (
                <span className={css.loopArrow} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m13 6 6 6-6 6" />
                  </svg>
                </span>
              )}
              <div className={`${css.loopStep} ${step.current ? css.loopStepOn : ""}`}>
                <span className={`${css.stepNum} ${step.current ? css.stepNumOn : ""}`}>
                  {step.num}
                </span>
                <h3 className={css.stepH3}>{step.title}</h3>
                <p className={css.stepP}>{step.text}</p>
              </div>
            </Fragment>
          ))}
        </div>
      </section>

      <div className={css.whyFoot}>
        <Link className={kit.btnPrimary} href="/demo/lesson" prefetch={false}>
          Back to today&apos;s lesson
        </Link>
        <Link className={css.quietLink} href="/demo/review-inbox" prefetch={false}>
          See what&apos;s in the review inbox
        </Link>
      </div>
    </div>
  );
}

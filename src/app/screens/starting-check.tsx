"use client";

// Optional starting check — three self-rating questions, explicitly not a
// test (sample port of temp/starting-check.html). Calm recommendation the
// learner can override, plus a real skip path. Memory-only state.

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import kit from "../kit.module.css";
import css from "./recall-screens.module.css";

type Level = "low" | "mid" | "high";
type Qid = "algebra" | "code" | "ml";

type Question = {
  id: Qid;
  title: string;
  note: string;
  answers: readonly { v: Level; label: string }[];
};

const QUESTIONS: readonly Question[] = [
  {
    id: "algebra",
    title: "How comfortable are you with basic algebra?",
    note: "Things like rearranging y = mx + b, or reading a slope off a line.",
    answers: [
      { v: "low", label: "It has been a while — I'd want the gentle version." },
      { v: "mid", label: "Comfortable enough with a worked example nearby." },
      { v: "high", label: "Comfortable — I use it regularly." },
    ],
  },
  {
    id: "code",
    title: "Have you read code before?",
    note: "The study shows small code snippets. Reading them helps, but each one is also explained in words.",
    answers: [
      { v: "low", label: "Never — code looks like noise to me." },
      { v: "mid", label: "A little — I can follow short examples." },
      { v: "high", label: "Yes — I read or write code regularly." },
    ],
  },
  {
    id: "ml",
    title: "How much do you already know about neural networks?",
    note: 'Honest answers help here — "nothing yet" is a perfectly good answer.',
    answers: [
      { v: "low", label: "Nothing yet — that's why I'm here." },
      { v: "mid", label: "I've read about them, but never worked through the math." },
      { v: "high", label: "I've trained one, or worked through the math by hand." },
    ],
  },
];

function suggestion(algebra: Level, code: Level, ml: Level): string {
  const levels = [algebra, code, ml];
  const lows = levels.filter(level => level === "low").length;
  const highs = levels.filter(level => level === "high").length;
  if (lows >= 2) {
    return 'We\'ll start you at lesson 1, "The perceptron, by hand." It assumes no background, and every code snippet there is walked through in words first.';
  }
  if (highs >= 2) {
    return 'You may find lesson 2, "What a loss measures," a comfortable start — lesson 1 covers ground you likely know. Lesson 1 stays open if you want the refresher.';
  }
  return 'We\'d suggest starting at lesson 1, "The perceptron, by hand" — it\'s short, and it makes the rest of the study much easier. Skimming it costs little; missing it costs more.';
}

export function StartingCheck() {
  const [answers, setAnswers] = useState<Record<Qid, Level | undefined>>({
    algebra: undefined,
    code: undefined,
    ml: undefined,
  });
  const [result, setResult] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const continueRef = useRef<HTMLAnchorElement | null>(null);
  const firstRowRef = useRef<HTMLInputElement | null>(null);

  const { algebra, code, ml } = answers;
  const allAnswered = algebra !== undefined && code !== undefined && ml !== undefined;

  const pick = (q: Qid, v: Level) => setAnswers(prev => ({ ...prev, [q]: v }));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!algebra || !code || !ml) return;
    setResult(suggestion(algebra, code, ml));
    // Focus lands on the recommendation once it has rendered (the reference
    // scrolls the result into view and focuses the continue action).
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ block: "nearest" });
      continueRef.current?.focus();
    }, 0);
  };

  const redo = () => {
    setResult(null);
    setAnswers({ algebra: undefined, code: undefined, ml: undefined });
    firstRowRef.current?.focus();
  };

  return (
    <div className={`${css.screen} ${css.w720}`}>
      <div className={css.checkHead}>
        <h1 className={css.pageH1}>A quick starting check</h1>
        <p className={css.sub}>
          Three questions so your first lessons meet you where you are. This is not a test — nothing
          is scored, and nothing here is stored against you.
        </p>
        <p className={`${css.notePlate} ${css.optNote}`}>
          This check is optional. You can skip it and start at lesson 1 — you will not be asked
          again, and you can redo it later from settings.
        </p>
      </div>

      <form className={css.checkForm} noValidate onSubmit={submit}>
        {QUESTIONS.map(q => (
          <section className={css.checkQ} key={q.id} aria-labelledby={`${q.id}-h`}>
            <h2 id={`${q.id}-h`} className={css.qTitle}>
              {q.title}
            </h2>
            <p className={css.qNote}>{q.note}</p>
            <fieldset className={css.answers}>
              <legend className={css.srOnly}>{q.title}</legend>
              {q.answers.map(a => {
                const selected = answers[q.id] === a.v;
                const inputId = `${q.id}-${a.v}`;
                return (
                  <div
                    className={`${selected ? kit.answerRowSelected : kit.answerRow} ${css.answerWrap}`}
                    key={a.v}
                  >
                    <input
                      type="radio"
                      id={inputId}
                      name={q.id}
                      className={css.answerInput}
                      checked={selected}
                      onChange={() => pick(q.id, a.v)}
                      ref={q.id === "algebra" && a.v === "low" ? firstRowRef : undefined}
                    />
                    <label className={css.answerLabel} htmlFor={inputId}>
                      <span className={kit.radioDot} aria-hidden="true" />
                      <span>{a.label}</span>
                    </label>
                  </div>
                );
              })}
            </fieldset>
          </section>
        ))}
        <div className={css.checkActions}>
          <button
            type="submit"
            className={`${kit.btnPrimary} ${css.seeStart}`}
            disabled={!allAnswered}
          >
            See my starting point
          </button>
          <Link className={css.quietLink} href="/library" prefetch={false}>
            Skip this — start at lesson 1
          </Link>
        </div>
      </form>

      {result !== null && (
        <div className={css.result} ref={resultRef}>
          <h2 className={css.qTitle}>Our suggestion</h2>
          <output className={css.resText}>{result}</output>
          <p className={css.resNote}>
            This is a suggestion, not a placement. You decide where to start, and you can move
            forward or back at any time — the roadmap never locks you in.
          </p>
          <div className={css.resActions}>
            <Link ref={continueRef} className={kit.btnSecondary} href="/library" prefetch={false}>
              Continue to the study
            </Link>
            <button type="button" className={css.quietLinkBtn} onClick={redo}>
              Change my answers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import kit from "../kit.module.css";
import styles from "./full-screens.module.css";

/* Mini-course player — full. One lesson shell switching across all six
   activity formats. Ported from temp/course-player-full.html (which ships
   no script: the step map, mark-complete flow and per-activity samples are
   the interactions its markup implies). All state is memory-only and resets
   on reload; every "AI" artifact is prewritten sample text. */

const STEPS = [
  { mapName: "The hillside you can’t see", format: "Text + images", minutes: 4 },
  { mapName: "Feel the step size", format: "Simulation", minutes: 3 },
  { mapName: "Mock interview", format: "Role play", minutes: 5 },
  { mapName: "Match the terms", format: "Mini-game", minutes: 3 },
  { mapName: "Narrated slides", format: "AI-narrated slides", minutes: 4 },
  { mapName: "Code one step", format: "Online coding", minutes: 6 },
] as const;

function StepIcon({ index }: { index: number }) {
  const paths: Record<number, React.ReactNode> = {
    0: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </>
    ),
    1: (
      <>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </>
    ),
    2: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    3: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    4: (
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="m10 8 4 2.5-4 2.5V8z" />
        <path d="M8 21h8" />
      </>
    ),
    5: (
      <>
        <path d="m8 6-6 6 6 6" />
        <path d="m16 6 6 6-6 6" />
      </>
    ),
  };
  return (
    <svg
      className={styles.mapIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[index]}
    </svg>
  );
}

/* ── step 2: simulation ─────────────────────────────────────────────── */

function lossPath(lr: number): string {
  let w = 2;
  const pts: string[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const loss = Math.min(w * w, 3);
    const x = 20 + (i / 40) * 560;
    const y = 220 - (loss / 3) * 200;
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
    w = w - lr * 2 * w;
  }
  return pts.join(" ");
}

function simStatus(lr: number): string {
  if (lr < 0.5) {
    return "Loss falls steadily toward zero — each step lands closer to the valley floor.";
  }
  if (lr === 0.5) {
    return "At lr = 0.50 a single step lands exactly on the valley floor.";
  }
  if (lr < 1) {
    return "Loss oscillates while shrinking — steps overshoot the floor, but each one still lands closer.";
  }
  if (lr === 1) {
    return "Loss bounces between two values forever — every step crosses the entire valley.";
  }
  return "Loss diverges — every step leaps higher up the far wall. This is the failure from step 1.";
}

function SimulationStep() {
  const [lr, setLr] = useState(0.3);
  return (
    <section className={styles.stepPanel} aria-labelledby="cf-sim-h">
      <p className={styles.stepKicker}>Step 2 · Simulation</p>
      <h1 id="cf-sim-h" className={styles.titleXl}>
        Feel the step size
      </h1>
      <p className={styles.leadIn}>
        Drag the learning rate and watch forty training steps on a simple
        one-weight model. The curve shows the loss after each step.
      </p>
      <div className={styles.simControls}>
        <label htmlFor="cf-lr">Learning rate</label>
        <input
          id="cf-lr"
          className={styles.simRange}
          type="range"
          min="0.05"
          max="1.2"
          step="0.05"
          value={lr}
          onChange={(e) => setLr(Number(e.target.value))}
          aria-describedby="cf-sim-status"
        />
        <span className={`${styles.simReadout} ${kit.num}`}>
          lr = {lr.toFixed(2)}
        </span>
      </div>
      <div className={styles.simFigure}>
        <svg
          viewBox="0 0 600 240"
          aria-label={`Loss curve over forty training steps at learning rate ${lr.toFixed(2)}`}
        >
          <title>{`Loss curve over forty training steps at learning rate ${lr.toFixed(2)}`}</title>
          <line x1="20" y1="220" x2="580" y2="220" stroke="var(--border-soft)" strokeWidth="1" />
          <line x1="20" y1="20" x2="20" y2="220" stroke="var(--border-soft)" strokeWidth="1" />
          <text x="20" y="14" fontSize="11" fill="var(--meta)">
            loss (clamped at 3)
          </text>
          <text x="540" y="236" fontSize="11" fill="var(--meta)">
            40 steps
          </text>
          <path
            d={lossPath(lr)}
            fill="none"
            stroke="var(--fg)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className={styles.simStatus} id="cf-sim-status" aria-live="polite">
        {simStatus(lr)}
      </p>
      <p className={styles.simCap}>
        A correct tiny simulation: one weight, loss = w², gradient = 2w,
        update w = w − lr · 2w. Above lr = 1 the steps overshoot and the loss
        diverges.
      </p>
    </section>
  );
}

/* ── step 3: role play / mock interview ──────────────────────────────── */

function RoleplayStep() {
  const [sampleOpen, setSampleOpen] = useState(false);
  return (
    <section className={styles.stepPanel} aria-labelledby="cf-rp-h">
      <p className={styles.stepKicker}>Step 3 · Role play · Mock interview</p>
      <h1 id="cf-rp-h" className={styles.titleXl}>
        Explain it back
      </h1>
      <p className={styles.leadIn}>
        A mock interview: answer in your own words before you peek at the
        sample. The interviewer prompt and the sample response were both
        written ahead of time.
      </p>
      <div className={styles.interviewer}>
        <p className={styles.who}>Interviewer · prewritten prompt</p>
        <p className={styles.prompt}>
          “Suppose you train a model and, right after one step, the loss jumps
          up instead of down. In your own words — what’s the first thing you’d
          suspect, and why?”
        </p>
      </div>
      <label className={styles.rpLabel} htmlFor="cf-rp-answer">
        Your answer (private to you)
      </label>
      <textarea
        id="cf-rp-answer"
        className={`${kit.textarea} ${styles.rpInput}`}
        placeholder="I’d suspect the step was too big, because…"
      />
      <button
        type="button"
        className={kit.btnSecondary}
        aria-expanded={sampleOpen}
        aria-controls="cf-rp-sample"
        onClick={() => setSampleOpen(!sampleOpen)}
      >
        {sampleOpen ? "Hide the sample response" : "Show a sample response"}
      </button>
      {sampleOpen && (
        <div className={styles.rpSample} id="cf-rp-sample">
          <p className={styles.who}>
            Sample response · prewritten sample — no live AI
          </p>
          <p>
            “The first thing I’d suspect is the learning rate. Each step moves
            the weights by lr times the gradient, and if that step is longer
            than the valley is wide, the model lands on the far wall, higher
            than where it started — so the loss goes up. Halving the learning
            rate is the usual first move, and I’d watch the next few steps to
            confirm the loss falls again.”
          </p>
        </div>
      )}
    </section>
  );
}

/* ── step 4: mini-game ───────────────────────────────────────────────── */

type MgCard = { pair: number; kind: "Term" | "Meaning"; face: string };

const MG_CARDS: readonly MgCard[] = [
  { pair: 1, kind: "Term", face: "Gradient" },
  { pair: 2, kind: "Meaning", face: "How long each step downhill is" },
  { pair: 3, kind: "Term", face: "Loss" },
  { pair: 1, kind: "Meaning", face: "The direction the loss increases fastest" },
  { pair: 2, kind: "Term", face: "Learning rate" },
  { pair: 3, kind: "Meaning", face: "One number for how wrong the model is" },
];

const MG_MISS_MS = 900;

function MinigameStep() {
  const [selected, setSelected] = useState<number | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<number[]>([]);
  const [missed, setMissed] = useState<number[]>([]);
  const missTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (missTimer.current !== null) window.clearTimeout(missTimer.current);
    },
    [],
  );

  function pick(i: number) {
    if (missTimer.current !== null) {
      window.clearTimeout(missTimer.current);
      missTimer.current = null;
    }
    if (missed.length > 0) setMissed([]);
    if (matchedPairs.includes(MG_CARDS[i].pair)) return;
    if (selected === i) {
      setSelected(null);
      return;
    }
    if (selected === null) {
      setSelected(i);
      return;
    }
    const a = MG_CARDS[selected];
    const b = MG_CARDS[i];
    if (a.pair === b.pair) {
      const pair = a.pair;
      setMatchedPairs((prev) => [...prev, pair]);
      setSelected(null);
    } else {
      setMissed([selected, i]);
      setSelected(null);
      missTimer.current = window.setTimeout(() => {
        missTimer.current = null;
        setMissed([]);
      }, MG_MISS_MS);
    }
  }

  return (
    <section className={styles.stepPanel} aria-labelledby="cf-mg-h">
      <p className={styles.stepKicker}>Step 4 · Mini-game</p>
      <h1 id="cf-mg-h" className={styles.titleXl}>
        Match the terms
      </h1>
      <p className={styles.leadIn}>
        Six cards, three pairs. Pick a term and its meaning to clear them.
        Mismatches flip back — that’s the practice working.
      </p>
      <fieldset
        className={styles.mgGrid}
        aria-label="Match the terms: six cards, three pairs"
      >
        {MG_CARDS.map((card, i) => {
          const isMatched = matchedPairs.includes(card.pair);
          const isSelected = selected === i;
          const isMissed = missed.includes(i);
          const cls = [
            styles.mgCard,
            isMatched ? styles.matched : "",
            isSelected ? styles.selected : "",
            isMissed ? styles.missed : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={`${card.kind}-${card.face}`}
              type="button"
              className={cls}
              onClick={() => pick(i)}
              disabled={isMatched}
            >
              <span className={styles.mgKind}>{card.kind}</span>
              <span className={styles.mgFace}>{card.face}</span>
            </button>
          );
        })}
      </fieldset>
      <p className={styles.mgStatus} aria-live="polite">
        {matchedPairs.length === MG_CARDS.length / 2
          ? "All 3 pairs matched."
          : `${matchedPairs.length} of 3 pairs matched.`}
      </p>
    </section>
  );
}

/* ── step 5: AI-narrated slides ──────────────────────────────────────── */

const SLIDES = [
  {
    title: "Where we start",
    body: "The model has one weight, w, and the loss tells us how wrong it is. Right now the loss is high — we are standing high on the hillside.",
    transcript:
      "Let’s keep it tiny: one weight, one number for how wrong we are. The loss is our altitude. High loss, high on the hill. Everything that follows is about getting down.",
  },
  {
    title: "Feel the slope",
    body: "The gradient measures the local slope under our feet. It points uphill — toward higher loss. We want to move the opposite way.",
    transcript:
      "We can’t see the valley in the fog, but we can feel the slope. The gradient is that slope, and it points uphill. So the sensible direction is against it.",
  },
  {
    title: "Step, then repeat",
    body: "We move a small amount against the gradient, scaled by the learning rate. Then we measure again. That loop is all of training.",
    transcript:
      "One small step downhill, sized by the learning rate. Then measure the slope again, from the new spot. Step, measure, step — that loop, repeated, is training.",
  },
] as const;

function SlidesStep() {
  const [slide, setSlide] = useState(0);
  const current = SLIDES[slide];
  return (
    <section className={styles.stepPanel} aria-labelledby="cf-slides-h">
      <p className={styles.stepKicker}>Step 5 · AI-narrated slides</p>
      <h1 id="cf-slides-h" className={styles.titleXl}>
        One step, narrated
      </h1>
      <div className={styles.slideCard}>
        <p className={`${styles.slideCount} ${kit.num}`}>
          Slide {slide + 1} of {SLIDES.length}
        </p>
        <h2 className={styles.titleLg}>{current.title}</h2>
        <p className={styles.slideBody}>{current.body}</p>
      </div>
      <div className={styles.slideNav}>
        <button
          type="button"
          className={kit.btnSecondary}
          onClick={() => setSlide(slide - 1)}
          disabled={slide === 0}
        >
          ← Previous slide
        </button>
        <button
          type="button"
          className={kit.btnSecondary}
          onClick={() => setSlide(slide + 1)}
          disabled={slide === SLIDES.length - 1}
        >
          Next slide →
        </button>
      </div>
      <div className={styles.transcript}>
        <p className={styles.who}>Narration transcript · prewritten — no live AI</p>
        <p>{current.transcript}</p>
      </div>
    </section>
  );
}

/* ── step 6: online coding ───────────────────────────────────────────── */

const SAMPLE_CODE = `# one weight, one step, forty times
w = 2.0
lr = 0.3
for step in range(40):
    grad = 2 * w        # slope of loss = w^2
    w = w - lr * grad   # step downhill
    if step % 10 == 0:
        print(step, round(w * w, 4))`;

const SAMPLE_OUTPUT = `0 4.0
10 0.0007
20 0.0
30 0.0

The loss falls to zero: with lr = 0.3 each step
shrinks the weight to 0.4 of itself, and 0.4²
collapses fast. Try lr above 1 in the simulation
step to see the same loop diverge.`;

function CodingStep() {
  const [outputShown, setOutputShown] = useState(false);
  return (
    <section className={styles.stepPanel} aria-labelledby="cf-code-h">
      <p className={styles.stepKicker}>Step 6 · Online coding</p>
      <h1 id="cf-code-h" className={styles.titleXl}>
        Code one step
      </h1>
      <p className={styles.leadIn}>
        Edit the training loop, then press Run. In this prototype Run shows a
        prewritten sample output — no code executes here.
      </p>
      <div className={styles.codeEditor}>
        <textarea
          className={styles.codeArea}
          aria-label="Editable training loop code"
          spellCheck={false}
          defaultValue={SAMPLE_CODE}
        />
      </div>
      <button
        type="button"
        className={kit.btnSecondary}
        onClick={() => setOutputShown(true)}
      >
        Run
      </button>
      {outputShown && (
        <div className={styles.codeOutput} aria-live="polite">
          <p className={styles.codeOutWho}>
            Sample output · prewritten — no code runs in this prototype
          </p>
          <pre>{SAMPLE_OUTPUT}</pre>
        </div>
      )}
    </section>
  );
}

/* ── step 1: text + images ───────────────────────────────────────────── */

function TextStep() {
  return (
    <section className={styles.stepPanel} aria-labelledby="cf-text-h">
      <p className={styles.stepKicker}>Step 1 · Text + images</p>
      <h1 id="cf-text-h" className={styles.titleXl}>
        The hillside you can’t see
      </h1>
      <p className={styles.leadIn}>
        Imagine standing on a hillside in thick fog. You can’t see the valley,
        but you can feel the slope under your feet. Gradient descent is the
        strategy of always stepping slightly downhill.
      </p>
      <p>
        The loss function is that hillside. Each weight in the network is a
        coordinate of your position, and the loss is your altitude — how wrong
        the model currently is. You can’t jump to the bottom, because you
        don’t know where it is. What you <em>can</em> do is measure the local
        slope: the gradient. It points uphill, so you step the other way.
      </p>
      <figure>
        <div className={styles.imgPlaceholder}>
          <div>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <p className={styles.phLabel}>
              Sample image placeholder
              <br />
              Final art self-hosted per CSP
            </p>
          </div>
        </div>
        <figcaption className={styles.figCap}>
          Figure 1 · A hiker on the foggy hillside, mid-step downhill. Sample
          image placeholder — final art self-hosted per CSP.
        </figcaption>
      </figure>
      <p>
        Step size is the whole game. Too small, and you shuffle for hours
        without reaching the valley. Too big, and you leap over the valley
        floor entirely — the loss goes <em>up</em>, and the next step leaps
        even further. The next step lets you feel that difference with your
        own hands.
      </p>
    </section>
  );
}

/* ── shell ───────────────────────────────────────────────────────────── */

export function CourseFull() {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<boolean[]>(() =>
    STEPS.map(() => false),
  );
  const allDone = completed.every(Boolean);

  function markComplete() {
    setCompleted((prev) => {
      const next = [...prev];
      next[current] = true;
      return next;
    });
    if (current < STEPS.length - 1) setCurrent(current + 1);
  }

  return (
    <div className={styles.wide}>
      <span className={`${kit.metaText} ${styles.metaLine}`}>
        Step {current + 1} of {STEPS.length} · {STEPS[current].format} · ~
        {STEPS[current].minutes} min
      </span>

      <nav className={styles.lessonMap} aria-label="Lesson steps">
        <p className={styles.mapTitle}>How neural networks learn</p>
        <ol className={styles.mapList}>
          {STEPS.map((step, i) => {
            const state =
              i === current ? "current" : completed[i] ? "done" : undefined;
            return (
              <li key={step.mapName}>
                <button
                  type="button"
                  className={`${styles.mapBtn} ${state ? styles[state] : ""}`}
                  aria-current={i === current ? "step" : undefined}
                  onClick={() => setCurrent(i)}
                >
                  <span className={styles.mapDot} aria-hidden="true" />
                  <StepIcon index={i} />
                  <span>{step.mapName}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={styles.twoCol}>
        <article className={styles.lessonBody}>
          {current === 0 && <TextStep />}
          {current === 1 && <SimulationStep />}
          {current === 2 && <RoleplayStep />}
          {current === 3 && <MinigameStep />}
          {current === 4 && <SlidesStep />}
          {current === 5 && <CodingStep />}

          <nav className={styles.lessonNav} aria-label="Lesson steps">
            <button
              type="button"
              className={kit.btnSecondary}
              onClick={() => setCurrent(current - 1)}
              disabled={current === 0}
            >
              ← Previous step
            </button>
            <div className={styles.stepActions}>
              <button
                type="button"
                className={kit.btnSecondary}
                onClick={() => setCurrent(current + 1)}
                disabled={current === STEPS.length - 1}
              >
                Next step →
              </button>
              <button
                type="button"
                className={kit.btnPrimary}
                onClick={markComplete}
                disabled={completed[current]}
              >
                {completed[current] ? "Step complete" : "Mark step complete"}
              </button>
            </div>
          </nav>
          {allDone && (
            <p className={styles.completeNote} aria-live="polite">
              All six steps complete. In the full product this would update
              your roadmap and schedule reviews from what you practiced.
            </p>
          )}
        </article>

        <aside className={styles.notebook} aria-labelledby="cf-nb-h">
          <h2 id="cf-nb-h" className={styles.titleMd}>
            Notebook
          </h2>
          <p className={styles.nbHelp}>
            Private to you. In this sample your notes stay on this screen.
          </p>
          <textarea
            className={kit.textarea}
            aria-label="Lesson notes"
            placeholder="In my own words: the gradient tells me…"
          />
          <p className={styles.nbSaved}>
            Session only — notes reset on reload · nothing is stored in this
            sample
          </p>
        </aside>
      </div>
    </div>
  );
}

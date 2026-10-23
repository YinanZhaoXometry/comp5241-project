"use client";

import Link from "next/link";
import kit from "../kit.module.css";
import styles from "./full-screens.module.css";

/* Roadmap — full. Eight nodes in three phases with factual Done / Current /
   Upcoming / Locked states, honest unlock conditions and an evidence-based
   "Where you are" panel. Ported from temp/roadmap.html (static sample data —
   nothing here changes in this prototype; states are fixed sample facts). */

type NodeState = "done" | "current" | "upcoming" | "locked";

type RoadNode = {
  id: string;
  title: string;
  type: string;
  meta: string;
  state: NodeState;
  href?: string;
  lockNote?: string;
};

type Phase = {
  id: string;
  title: string;
  meta: string;
  nodes: readonly RoadNode[];
};

const PHASES: readonly Phase[] = [
  {
    id: "phase-foundations",
    title: "Phase 1 · Foundations",
    meta: "3 steps · ~37 min · complete",
    nodes: [
      {
        id: "node-1",
        title: "What a neuron computes",
        type: "Reading",
        meta: "Lesson 1 · ~12 min",
        state: "done",
        href: "/course",
      },
      {
        id: "node-2",
        title: "What a loss measures",
        type: "Reading",
        meta: "Lesson 2 · ~10 min",
        state: "done",
        href: "/course",
      },
      {
        id: "node-3",
        title: "Gradient descent, step by step",
        type: "Simulation",
        meta: "Lesson 3 · ~15 min",
        state: "done",
        href: "/course",
      },
    ],
  },
  {
    id: "phase-core",
    title: "Phase 2 · Core mechanics",
    meta: "3 steps · ~44 min · in progress",
    nodes: [
      {
        id: "node-4",
        title: "Why learning rates matter",
        type: "Practice",
        meta: "Lesson 4 · ~12 min",
        state: "current",
        href: "/practice",
      },
      {
        id: "node-5",
        title: "Backpropagation, the long version",
        type: "Reading",
        meta: "Lesson 5 · ~18 min",
        state: "upcoming",
        href: "/course",
      },
      {
        id: "node-6",
        title: "Reading a training curve",
        type: "Simulation",
        meta: "Lesson 6 · ~14 min",
        state: "locked",
        lockNote: "Unlocks after the practice check on lesson 4.",
      },
    ],
  },
  {
    id: "phase-application",
    title: "Phase 3 · Application",
    meta: "2 steps · ~46 min · not started",
    nodes: [
      {
        id: "node-7",
        title: "Overfitting and how to see it",
        type: "Reading",
        meta: "Lesson 7 · ~16 min",
        state: "locked",
        lockNote: "Unlocks after the practice check on lesson 4.",
      },
      {
        id: "node-8",
        title: "Build a tiny trainer",
        type: "Project",
        meta: "Lesson 8 · ~30 min",
        state: "locked",
        lockNote: "Unlocks after lessons 6 and 7 are done.",
      },
    ],
  },
];

const STATE_LABEL: Record<NodeState, string> = {
  done: "Done",
  current: "Current",
  upcoming: "Upcoming",
  locked: "Locked",
};

function NodeMarker({ state }: { state: NodeState }) {
  if (state === "done") {
    return (
      <span className={styles.nodeMarker} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className={styles.nodeMarker} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
    );
  }
  return <span className={styles.nodeMarker} aria-hidden="true" />;
}

function StatePill({ state }: { state: NodeState }) {
  const label = STATE_LABEL[state];
  if (state === "current") {
    return (
      <span className={`${styles.nState} ${styles.pillCurrent}`}>
        <span className={styles.dot} />
        {label}
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className={`${styles.nState} ${styles.pillLocked}`}>
        <span className={styles.dot} />
        {label}
      </span>
    );
  }
  return (
    <span className={`${styles.nState} ${kit.pillMuted}`}>
      <span className={kit.dot} />
      {label}
    </span>
  );
}

const NODE_CLASS: Record<NodeState, string> = {
  done: styles.nodeDone,
  current: styles.nodeCurrent,
  upcoming: styles.nodeUpcoming,
  locked: styles.nodeLocked,
};

function RoadmapNode({ node }: { node: RoadNode }) {
  const body = (
    <>
      <span>
        <span className={styles.nTitle}>{node.title}</span>
        <span className={styles.nMeta}>
          <span className={styles.nType}>{node.type}</span>
          <span>{node.meta}</span>
        </span>
        {node.lockNote && <span className={styles.nLockNote}>{node.lockNote}</span>}
      </span>
      <StatePill state={node.state} />
    </>
  );
  return (
    <li
      className={`${styles.node} ${NODE_CLASS[node.state]} ${
        node.state !== "locked" ? styles.nodeLink : ""
      }`}
      aria-current={node.state === "current" ? "step" : undefined}
    >
      <NodeMarker state={node.state} />
      {node.href ? (
        <Link className={styles.nodeCard} href={node.href} prefetch={false}>
          {body}
        </Link>
      ) : (
        <div className={styles.nodeCard}>{body}</div>
      )}
    </li>
  );
}

const WHERE_ROWS: readonly { label: string; value: string }[] = [
  { label: "Steps done", value: "3 of 8" },
  { label: "Current step", value: "Lesson 4" },
  { label: "Time so far", value: "~37 min" },
  { label: "Reviews due", value: "3 in the inbox" },
];

export function Roadmap() {
  return (
    <div className={styles.wide}>
      <div className={styles.pageHead}>
        <h1 className={styles.titleXl}>Roadmap</h1>
        <p className={styles.sub}>
          The whole study on one line: eight steps in three phases. States are
          factual — done, current, upcoming, or locked — and locked steps say
          exactly what unlocks them. No points, no streaks.
        </p>
        <span className={`${kit.metaText} ${styles.metaLine}`}>
          Roadmap — full · How neural networks learn · Sample data · week 3 of
          6
        </span>
      </div>

      <div className={styles.twoCol}>
        <div>
          {PHASES.map((phase) => (
            <section
              key={phase.id}
              className={styles.phase}
              aria-labelledby={`${phase.id}-h`}
            >
              <div className={styles.phaseHead}>
                <h2 id={`${phase.id}-h`} className={styles.titleMd}>
                  {phase.title}
                </h2>
                <span className={styles.phaseMeta}>{phase.meta}</span>
              </div>
              <ol className={styles.tl}>
                {phase.nodes.map((node) => (
                  <RoadmapNode key={node.id} node={node} />
                ))}
              </ol>
            </section>
          ))}
        </div>

        <aside className={styles.wherePanel} aria-labelledby="rm-where-h">
          <h2 id="rm-where-h" className={styles.titleMd}>
            Where you are
          </h2>
          <p className={styles.wEvidence}>
            Based on 3 completed lessons and 1 practice session. Nothing here
            is estimated beyond that evidence.
          </p>
          <div className={styles.wRows}>
            {WHERE_ROWS.map((row) => (
              <div className={styles.wRow} key={row.label}>
                <span>{row.label}</span>
                <span className={styles.wV}>{row.value}</span>
              </div>
            ))}
          </div>
          <p className={styles.wNext}>
            <strong>Suggested next step:</strong> finish the lesson 4 practice
            set — it is what unlocks lesson 6, and it feeds the two topics
            waiting in your review inbox.
          </p>
          <div className={styles.wActions}>
            <Link className={kit.btnPrimary} href="/course" prefetch={false}>
              Continue: Lesson 4
            </Link>
            <Link
              className={kit.btnSecondary}
              href="/recovery"
              prefetch={false}
            >
              Run the understanding check
            </Link>
          </div>
          <Link className={styles.wLink} href="/progress" prefetch={false}>
            See the evidence behind this →
          </Link>
        </aside>
      </div>
    </div>
  );
}

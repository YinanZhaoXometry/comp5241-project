"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import type { RoadmapNodeView, RoadmapView } from "../contracts/assessment";

type Props = { busy: boolean; onFailure: (error: unknown) => void; onOpen: (root: string) => void };

const nodeCopy: Record<NonNullable<RoadmapNodeView["state"]>, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

// Epic-3 story-6 — the whole-mini-course roadmap surface (R4/D1/D6): one
// node per entire mini-course across the learner's confirmed studies, states
// in words following the completion awards exactly (Completed only from an
// earned version-scoped award — never revoked by later results or review),
// separate Needs practice / Review due pills, the plan's recommended
// prerequisite order as numbering only — every node is open at any time, no
// locks, no XP — and the honest "Plan confirmed — course not generated" and
// version-superseded states. The Review-due pill renders only when a
// versioned review-state query binding exists; this build's port is the
// unbound stub, so the panel says so in words instead of rendering pills
// (never a wrong state). Light eventual-consistency re-read (the
// AssessmentStage pattern — never steals focus).
export function RoadmapPanel({ busy, onFailure, onOpen }: Props) {
  const [view, setView] = useState<RoadmapView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const failureRef = useRef(onFailure);
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  useEffect(() => {
    let live = true;
    const read = () => { void api<RoadmapView>("roadmap").then(value => { if (live) { setView(value); setLoaded(true); } }).catch(error => { if (live) failureRef.current(error); }); };
    read();
    const timer = setInterval(read, 3000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!loaded || !view) return null;
  return <section className="panel" aria-labelledby="study-roadmap-heading"><p className="eyebrow">STUDY ROADMAP · WHOLE MINI-COURSES</p><h3 id="study-roadmap-heading">Study roadmap</h3>
    <p className="fine">{view.note}</p>
    {view.reviewUnavailableNote && <p className="fine">{view.reviewUnavailableNote}</p>}
    {view.paths.length === 0 && <p>No confirmed plans yet. Confirm a study plan to start your roadmap.</p>}
    {view.paths.map((path, pathIndex) => <div className="tracker-row" key={path.manifestId ?? `standalone-${path.nodes[0]?.rootId ?? pathIndex}`}>
      <p><strong>{path.manifestId ? "Recommended path" : "Study path"}</strong>
        {path.completedAt && <> — <strong>path Completed</strong> {new Date(path.completedAt).toLocaleString()}</>}
        <span className="fine"> · recommended order below — guidance only, never a lock</span></p>
      <ol>
        {path.nodes.map(node => <li key={`${path.manifestId ?? "s"}:${node.rootId}`}>
          <p><strong>{node.title}</strong> <span className="fine">({node.topic})</span></p>
          <p>
            {node.state ? <><strong>{nodeCopy[node.state]}</strong>{node.version !== null ? <span className="fine"> · version {node.version}</span> : null}</> : <span className="fine">{node.courseStatus === "not-generated" ? "Plan confirmed — course not generated." : node.courseStatus === "pending" ? "Course generation in flight — the roadmap updates when it settles." : "Course generation failed — nothing saved; retry from the study."}</span>}
            {node.needsPractice && <strong> Needs practice</strong>}
            {node.reviewDue && <strong> Review due</strong>}
          </p>
          {node.superseded && node.version !== null && node.latestVersion !== null && <p className="fine">Version superseded — you stay on version {node.version}; version {node.latestVersion} is ready. Switching is your explicit choice and never erases awards.</p>}
          <div className="actions"><button className="quiet" disabled={busy} onClick={() => { onOpen(node.rootId); }}>Open this mini-course</button></div>
        </li>)}
      </ol>
    </div>)}
  </section>;
}

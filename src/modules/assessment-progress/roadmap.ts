import { ROADMAP_HONESTY_NOTE, REVIEW_STATE_PORT_VERSION, type ReviewDueState, type RoadmapNodeView, type RoadmapPathView, type RoadmapView } from "../../contracts/assessment";
import type { AttemptRow, AwardRow, RecoveryTargetRow } from "./repository";
import { deriveRoadmapNode } from "./scoring";

// Story 6 — the pure, deterministic whole-mini-course roadmap derivation
// (R4/D1/D6). Every input is an already-recorded fact (confirmed studies,
// resolved studied releases, R2 award rows, attempts, the recovery ledger,
// parent manifests, review-state port results); the roadmap is a READ-TIME
// view with no writes anywhere. Three rules, each mirroring an established
// derivation so the surfaces can never disagree:
//
//   Node state  — EXACTLY the story-4 rule (deriveRoadmapNode): Completed
//                 only from an earned version-scoped award pinning the
//                 resolved studied release (monotonic — nothing later
//                 un-completes it); In progress on real engagement (any
//                 attempt of the root, or a required item of the resolved
//                 release done); Not started otherwise. A passed/recovered
//                 attempt with no award yet keeps the node honestly In
//                 progress — the same window the assessment panel serves.
//   Needs       — the story-5 guidance classification at node altitude: an
//   practice      OPEN recovery-target group of the resolved release's own
//                 newest failed chain (observed difficulty, cause unnamed),
//                 suppressed by a newer graded PASSING attempt on that
//                 release (recovered normally — completion's own rule).
//                 Mirrors deriveGuidance's chain selection exactly so the
//                 node pill, the guidance panel and the recovery panel can
//                 never disagree about "still-failed".
//   Review due  — ONLY from the versioned review-state query port, pinned
//                 to the resolved release, and ONLY as a pill: the state
//                 derivation above never reads the review input (D6 — a due
//                 review can never remove or change completion, structurally).
//                 Unbound port (this build's default) → no pill on any node.
//
// Recommended order comes from the plan machinery only: a parent manifest
// path renders its studies in the manifest's pinned child order (the
// story-4 plan-pinned carrier); a study pinned by no manifest renders as its
// own single-node path in plan-confirmation order. The order is numbering,
// never enforcement — every node is freely browsable, no locks, no XP.

export const REVIEW_UNAVAILABLE_NOTE =
  "Review scheduling is not part of this build — no review pills render, and nothing about review changes completion.";

// One confirmed study of the owner (non-deleted): the roadmap's node source.
// "After goal selection" (R4) — only confirmed plans carry nodes; drafts and
// deleted/revoked studies never render (unauthorized nodes are not nodes).
export type RoadmapRootFact = {
  rootId: string;
  confirmedAt: Date;
  // plan.miniCourse.title / plan.topic — the plan-pinned names of the whole
  // mini-course this node stands for.
  title: string;
  topic: string;
};

// The resolved studied release of one root (explicit switch pointer, else
// the getCourse default resolution: the current confirmed revision's course
// row, else the latest ready one). requiredTotal/requiredDone are the
// epic-2 tracker facts of THAT release, consumed read-only — the same inputs
// deriveRoadmapNode reads in getAssessment.
export type RoadmapCourseFact = {
  rootId: string;
  courseId: string;
  // Null on pending/failed rows (no settled version exists); >= 1 on ready.
  version: number | null;
  status: "ready" | "pending" | "failed";
  requiredTotal: number;
  requiredDone: number;
};

export type RoadmapInput = {
  roots: RoadmapRootFact[];
  // Per root: the resolved course fact, or null when nothing is resolvable
  // (the honest "Plan confirmed — course not generated" state).
  resolved: Map<string, RoadmapCourseFact | null>;
  // The newest READY per-root version (the Version-superseded honesty input).
  latestReadyVersions: Map<string, number>;
  // The owner's earned mini-course award pins (course release ids).
  awardedCourseIds: string[];
  attempts: AttemptRow[];
  targets: RecoveryTargetRow[];
  // The owner's parent-manifest rows (pending and awarded alike).
  manifests: AwardRow[];
  // courseId -> rootId for every manifest child release of this owner (a
  // path groups STUDIES; a regenerated release keeps its study in the path).
  courseRoots: Map<string, string>;
  // The review-state port results for the resolved ready releases (empty
  // when the port is unbound — never a wrong state, never a pill).
  reviewStates: Map<string, ReviewDueState>;
  reviewPortBound: boolean;
};

// The guidance chain rule at node altitude (deriveGuidance's mirror): the
// newest graded-failed attempt OF THE RESOLVED RELEASE that has a ledger,
// suppressed whole when a newer graded PASSING attempt on the same release
// satisfied the requirement normally. Practice evidence never enters — the
// pill is observed scored difficulty only (D2/AD-7).
function nodeNeedsPractice(courseId: string, attempts: AttemptRow[], targets: RecoveryTargetRow[]): boolean {
  const studied = attempts.filter(row => row.course_id === courseId && row.status === "graded");
  const ledgerOf = (attemptId: string) => targets.filter(target => target.root_attempt_id === attemptId);
  const chain = studied.find(row => row.passed === false && ledgerOf(row.id).length > 0) ?? null;
  if (!chain) return false;
  const suppressed = studied.some(row => row.passed === true && row.created_at > chain.created_at);
  return !suppressed && ledgerOf(chain.id).some(target => target.status === "open");
}

function nodeOf(
  root: RoadmapRootFact,
  course: RoadmapCourseFact | null,
  latestReady: number | null,
  awarded: Set<string>,
  rootAttempts: AttemptRow[],
  targets: RecoveryTargetRow[],
  reviewState: ReviewDueState | undefined,
): RoadmapNodeView {
  if (!course)
    return {
      rootId: root.rootId,
      title: root.title,
      topic: root.topic,
      courseId: null,
      version: null,
      courseStatus: "not-generated",
      state: null,
      needsPractice: false,
      reviewDue: false,
      superseded: false,
      latestVersion: latestReady,
    };
  if (course.status !== "ready")
    return {
      rootId: root.rootId,
      title: root.title,
      topic: root.topic,
      courseId: course.courseId,
      version: course.version,
      courseStatus: course.status,
      state: null,
      needsPractice: false,
      reviewDue: false,
      superseded: false,
      latestVersion: latestReady,
    };
  // Ready: the story-4 node rule — Completed only from the award pinning
  // THIS resolved release; the review input is deliberately absent from
  // these inputs (D6: a due review can never remove completion). A ready
  // release always carries a settled version (the service resolves >= 1).
  const version = course.version ?? 1;
  const state = deriveRoadmapNode({
    awardOnCurrentVersion: awarded.has(course.courseId),
    requiredItems: { total: course.requiredTotal, done: course.requiredDone },
    anyAttempt: rootAttempts.length > 0,
  });
  // The review pill accepts ONLY a port result pinned to the exact resolved
  // release (courseId AND version) at the port's declared schema version,
  // with due === true; anything else — unbound port, no state, a mismatched
  // pin, an unexpected schema version (a future epic-4 bump while an older
  // binding stays loaded), due false — renders no pill (review disposition
  // 2026-10-29: the version field was decorative; it is load-bearing now).
  const reviewDue = reviewState !== undefined && reviewState.schemaVersion === REVIEW_STATE_PORT_VERSION && reviewState.courseId === course.courseId && reviewState.courseVersion === version && reviewState.due === true;
  return {
    rootId: root.rootId,
    title: root.title,
    topic: root.topic,
    courseId: course.courseId,
    version,
    courseStatus: "ready",
    state,
    needsPractice: nodeNeedsPractice(course.courseId, rootAttempts, targets),
    reviewDue,
    superseded: latestReady !== null && latestReady > version,
    latestVersion: latestReady,
  };
}

export function deriveRoadmapView(input: RoadmapInput): RoadmapView {
  const awarded = new Set(input.awardedCourseIds);
  const attemptsOfRoot = (rootId: string) => input.attempts.filter(row => row.root_id === rootId);
  const latestOf = (rootId: string) => input.latestReadyVersions.get(rootId) ?? null;
  const reviewOf = (courseId: string) => input.reviewStates.get(courseId);
  const factsOfRoot = new Map(input.roots.map(root => [root.rootId, root]));
  const nodeOfRoot = (rootId: string): RoadmapNodeView | null => {
    const root = factsOfRoot.get(rootId);
    if (!root) return null; // a manifest child outside the owner's confirmed study set (deleted/foreign) renders no node
    return nodeOf(root, input.resolved.get(rootId) ?? null, latestOf(rootId), awarded, attemptsOfRoot(rootId), input.targets, reviewOf((input.resolved.get(rootId) ?? null)?.courseId ?? ""));
  };

  // Path assembly. A root belongs to a manifest path when ANY of its course
  // releases is a pinned child (the path groups the STUDY; a regenerated
  // release keeps the study in its path while the node serves the resolved
  // release's honest state). A root in several manifests renders in each —
  // every path is its own pinned recommended order.
  const manifestRoots = new Set<string>();
  const paths: RoadmapPathView[] = [];
  for (const manifest of input.manifests) {
    if (!manifest.manifest) continue;
    const seen = new Set<string>();
    const nodes: RoadmapNodeView[] = [];
    for (const child of manifest.manifest.children) {
      const rootId = input.courseRoots.get(child.courseId);
      if (!rootId || seen.has(rootId)) continue; // duplicate pin of one study: the node renders once
      seen.add(rootId);
      manifestRoots.add(rootId);
      const node = nodeOfRoot(rootId);
      if (node) nodes.push(node);
    }
    if (nodes.length) paths.push({ manifestId: manifest.manifest_id, completedAt: manifest.awarded_at ? manifest.awarded_at.toISOString() : null, nodes });
  }
  // Standalone studies: their own single-node paths, plan-confirmation order
  // (the learner's own declared sequence — no invented prerequisites).
  for (const root of [...input.roots].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime() || (a.rootId < b.rootId ? -1 : 1))) {
    if (manifestRoots.has(root.rootId)) continue;
    const node = nodeOfRoot(root.rootId);
    if (node) paths.push({ manifestId: null, completedAt: null, nodes: [node] });
  }
  return {
    paths,
    reviewPortBound: input.reviewPortBound,
    reviewUnavailableNote: input.reviewPortBound ? null : REVIEW_UNAVAILABLE_NOTE,
    note: ROADMAP_HONESTY_NOTE,
  };
}

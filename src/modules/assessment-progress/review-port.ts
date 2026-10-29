import type { ReviewDueState, ReviewStateInput } from "../../contracts/assessment";

// Story 6 — the stubbed VERSIONED review-state QUERY PORT (the epic
// contract's touch point: "review-state query feeding the roadmap's
// Review-due indicator — stubbed port here, scheduling/verdict sequencing
// owned by epic-spaced-review"). This module owns ONLY the seam: a typed
// query function over (owner, exact course release) whose DEFAULT binding is
// UNBOUND — the no-op below resolves no state and performs no I/O.
//
// Unbound is a first-class honest state, not an error and never a wrong
// state: with the default binding the roadmap renders NO Review due pill on
// any node and the served view says plainly that review scheduling is not
// part of this build. When epic-spaced-review lands, it replaces the binding
// through bindReviewStateQuery (its own module init / route wiring — no
// caller here changes) with a real versioned query that returns
// ReviewDueState rows pinned to the exact course release. The port is a
// QUERY port: no scheduling, due-list, reminder or verdict behavior lives
// here, and nothing this module does can write or revoke anything.
//
// The structural D6 fence lives in roadmap.ts: the review input feeds ONLY
// the pill boolean — the node-state derivation never reads it, so a due
// review can never remove or change an earned completion.

export type ReviewStateQuery = (input: ReviewStateInput) => Promise<ReviewDueState | null>;

// The unbound default: resolves no state for every input, instantly, with
// zero I/O. This is the binding active in this build.
const unboundReviewStateQuery: ReviewStateQuery = async () => null;

// The active binding. Module-level and deliberately simple: one writer
// (bindReviewStateQuery, epic-spaced-review's), one reader (getRoadmap), and
// an honest served signal (reviewStatePortBound) so the surface can state
// the absence in words rather than rendering an empty-but-ambiguous pill.
let active: ReviewStateQuery = unboundReviewStateQuery;
let bound = false;

// Replace the binding (epic-spaced-review's entry point). A bound query must
// resolve a ReviewDueState pinned to the input's exact course release or
// null when that release has no review state; `due !== true` renders no pill
// on any path. Binding is one-way for a process's lifetime in this build —
// no unbind path exists because no honest surface needs one.
export function bindReviewStateQuery(query: ReviewStateQuery): void {
  active = query;
  bound = true;
}

// Whether a binding other than the unbound default is active — the served
// reviewPortBound signal.
export function reviewStatePortBound(): boolean {
  return bound;
}

// The reader getRoadmap calls per ready node. Never throws for the unbound
// default; a future binding's failure policy is that binding's own (the
// derivation treats a null as no state — never a wrong state).
export async function queryReviewState(input: ReviewStateInput): Promise<ReviewDueState | null> {
  return active(input);
}

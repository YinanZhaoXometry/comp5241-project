import { GUIDANCE_UNCERTAINTY_NOTE, type GuidanceEntry, type GuidancePracticeLane, type GuidanceScoredCitation, type GuidanceView } from "../../contracts/assessment";
import type { AttemptRow, RecoveryTargetRow, RetestRow } from "./repository";
import { earnedOfItem } from "./scoring";

// Story 5 — the pure, deterministic gap-guidance derivation (D2/AD-7). Every
// input is already-recorded typed evidence; guidance is a READ-TIME view with
// no writes, no awards and no AI dispatch anywhere (the live-narrated
// enhancement stays F-A blocked). Two classification rules, both version-
// honest (only evidence pinning the STUDIED course release participates):
//
//   Needs practice  — an OPEN recovery-target group of the served chain (the
//                     newest graded-failed attempt with a ledger), i.e.
//                     observed difficulty from graded evidence, cause unnamed.
//                     A graded PASSING attempt NEWER than the chain root
//                     suppresses the whole chain's entries: the requirement
//                     was satisfied normally (completion's own rule), so the
//                     groups are not still-failed and guidance, the recovery
//                     panel and the node can never disagree. Cleared targets
//                     and passed groups are never entries.
//   Unknown         — a release objective no graded attempt/retest item maps
//                     to (a blueprint may cover fewer objectives than the
//                     release has). Practice evidence NEVER flips Unknown:
//                     practice rows carry no score, so classification is a
//                     scored-evidence-only dimension while practice renders
//                     as its own labeled lane beside the citations.
//
// Citations are lean (container id + position + earned/points): the graded
// view already carries full item detail, so surfaces link to their evidence
// instead of duplicating it. The function returns null when there is no
// evidence to cite on the release (nothing to ground a recommendation in) or
// when nothing needs attention and nothing is Unknown.

export type PracticeSummaryInput = { objectiveIndex: number; evidenceKind: "unaided" | "assisted"; outcome: "correct" | "incorrect"; count: number };
export type PracticeLatestInput = { objectiveIndex: number; attempted: string; evidenceKind: "unaided" | "assisted"; submittedAt: Date };

export type GuidanceInput = {
  objectives: Array<{ index: number; text: string }>;
  studiedCourseId: string;
  attempts: AttemptRow[];
  targets: RecoveryTargetRow[];
  retests: RetestRow[];
  practiceSummaries: PracticeSummaryInput[];
  practiceLatestIncorrect: PracticeLatestInput[];
};

export function deriveGuidance(input: GuidanceInput): GuidanceView | null {
  const studiedAttempts = input.attempts.filter(row => row.course_id === input.studiedCourseId);
  const gradedStudied = studiedAttempts.filter(row => row.status === "graded");
  const studiedRetests = input.retests.filter(row => row.course_id === input.studiedCourseId && row.status === "graded");
  // No graded attempt, no graded retest and no practice row on the studied
  // release: there is no evidence to cite, so no guidance renders (the
  // offered disclosure already invites the test — an all-Unknown panel would
  // be redundant, not more honest).
  if (!gradedStudied.length && !studiedRetests.length && !input.practiceSummaries.length) return null;

  // Scored coverage: objective indexes some graded studied-release item maps
  // to. An ungraded (active) container covers nothing — its items have no
  // submitted answers.
  const covered = new Set<number>();
  for (const row of gradedStudied) for (const item of row.snapshot.items) covered.add(item.objectiveIndex);
  for (const row of studiedRetests) for (const item of row.snapshot.items) covered.add(item.objectiveIndex);

  // The served chain's own rule (getAssessment): the NEWEST graded-failed
  // attempt with a ledger — restricted to the studied release so guidance and
  // the recovery panel agree by construction.
  const ledgerOf = (attemptId: string) => input.targets.filter(target => target.root_attempt_id === attemptId);
  const chain = studiedAttempts.find(row => row.status === "graded" && row.passed === false && ledgerOf(row.id).length > 0) ?? null;
  // Recovered normally: a graded passing attempt NEWER than the chain root
  // satisfies the failed-test requirement ordinarily (the completion rule) —
  // the chain stays listed as history but its groups are not still-failed.
  const chainSuppressed = chain ? gradedStudied.some(row => row.passed === true && row.created_at > chain.created_at) : false;
  const chainTargets = chain && !chainSuppressed ? ledgerOf(chain.id).filter(target => target.status === "open") : [];

  const practiceOf = (index: number): GuidancePracticeLane | null => {
    const summaries = input.practiceSummaries.filter(row => row.objectiveIndex === index);
    if (!summaries.length) return null;
    const lane: GuidancePracticeLane = { unaidedCorrect: 0, unaidedIncorrect: 0, assistedCorrect: 0, assistedIncorrect: 0, latestIncorrect: null };
    for (const row of summaries) {
      if (row.evidenceKind === "unaided") { if (row.outcome === "correct") lane.unaidedCorrect += row.count; else lane.unaidedIncorrect += row.count; }
      else { if (row.outcome === "correct") lane.assistedCorrect += row.count; else lane.assistedIncorrect += row.count; }
    }
    const latest = input.practiceLatestIncorrect.find(row => row.objectiveIndex === index);
    if (latest) lane.latestIncorrect = { attempted: latest.attempted, evidenceKind: latest.evidenceKind, submittedAt: latest.submittedAt.toISOString() };
    return lane;
  };

  // Citations of a needs-practice group: the chain root attempt's non-perfect
  // items for that group, plus the group's failed graded-retest items
  // (partial recovery) — only still-open groups cite retest evidence, and
  // only graded containers cite at all.
  const scoredOf = (index: number): GuidanceScoredCitation[] => {
    if (!chain) return [];
    const citations: GuidanceScoredCitation[] = [];
    const chosen = new Map((chain.answers ?? []).map(answer => [answer.position, answer.choiceId]));
    for (const item of chain.snapshot.items) {
      if (item.objectiveIndex !== index) continue;
      const earned = earnedOfItem(item, chosen.get(item.position) ?? null);
      if (earned < item.points) citations.push({ source: "attempt", evidenceId: chain.id, position: item.position, earned, points: item.points });
    }
    for (const retest of input.retests) {
      if (retest.course_id !== input.studiedCourseId || retest.status !== "graded" || retest.root_attempt_id !== chain.id) continue;
      const group = (retest.group_results ?? []).find(result => result.objectiveIndex === index);
      if (!group || group.cleared) continue;
      const retestChosen = new Map((retest.answers ?? []).map(answer => [answer.position, answer.choiceId]));
      for (const item of retest.snapshot.items) {
        if (item.objectiveIndex !== index) continue;
        const earned = earnedOfItem(item, retestChosen.get(item.position) ?? null);
        if (earned < item.points) citations.push({ source: "targeted-retest", evidenceId: retest.id, position: item.position, earned, points: item.points });
      }
    }
    return citations;
  };

  const objectiveText = (index: number) =>
    input.objectives.find(objective => objective.index === index)?.text ?? chainTargets.find(target => target.objective_index === index)?.objective ?? "";

  const entries: GuidanceEntry[] = [];
  const needsPractice = new Set(chainTargets.map(target => target.objective_index));
  for (const target of [...chainTargets].sort((a, b) => a.objective_index - b.objective_index))
    entries.push({ objectiveIndex: target.objective_index, objective: objectiveText(target.objective_index), status: "needs-practice", scored: scoredOf(target.objective_index), practice: practiceOf(target.objective_index) });
  for (const objective of [...input.objectives].sort((a, b) => a.index - b.index))
    if (!covered.has(objective.index) && !needsPractice.has(objective.index))
      entries.push({ objectiveIndex: objective.index, objective: objective.text, status: "unknown", scored: [], practice: practiceOf(objective.index) });
  if (!entries.length) return null;
  return { entries, note: GUIDANCE_UNCERTAINTY_NOTE };
}

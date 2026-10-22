import { bundleCatalogSchema, type BundleCatalog, type BundleItem } from "../../contracts/diagnostic";
import type { Plan } from "../../contracts/setup";
import { fail } from "../../platform/errors";

// MANUALLY AUTHORED SYNTHETIC FIXTURE — NOT generator output. S6's eligible
// generator is blocked (F3), so this infrastructure pins a bounded, hand-written
// and hand-validated item set instead; the take-path acceptance on an eligible
// generator stays open until that blocker clears. The catalog is validated
// independently of any generator by tests/unit/diagnostic.test.ts.
//
// {objective} and {source} are the only plan-derived substitutions, resolved
// from the exact confirmed plan revision at take time; item text is inert data
// and can never execute instructions. Items whose objective/source links do
// not resolve against the confirmed plan are rejected (the honest Unavailable
// state), never silently renumbered or fabricated.
const objectiveSlot = "{objective}";
const sourceSlot = "{source}";

export const syntheticCatalog: BundleCatalog = bundleCatalogSchema.parse({
  source: "manual-synthetic",
  items: [
    {
      objectiveIndex: 0,
      sourcePosition: 0,
      prompt: `You are about to begin the outcome "${objectiveSlot}" using the selected source "${sourceSlot}". Which first step best supports understanding before any practice?`,
      choices: [
        { id: "a", text: "Skim the source once and move straight to practice without reading for the outcome." },
        { id: "b", text: "Read the part of the source that bears on the outcome and write one sentence connecting the two." },
        { id: "c", text: "Replace the source with the first search result instead of reading the selected revision." },
        { id: "d", text: "Memorize the outcome wording verbatim without opening the source." },
      ],
      answerId: "b",
      rationale: "Reading for a specific outcome and restating the link gives later practice something to correct; rote recall or source substitution does not check starting understanding.",
    },
    {
      objectiveIndex: 1,
      sourcePosition: 1,
      prompt: `Partway through "${sourceSlot}" you cannot explain how it serves the outcome "${objectiveSlot}". What is the honest next step?`,
      choices: [
        { id: "a", text: "Keep reading to the end and hope the connection becomes clear on its own." },
        { id: "b", text: "Mark the gap, re-read that section, and note it as a missing explanation for a future plan revision." },
        { id: "c", text: "Restart the entire source from the first page regardless of the gap." },
        { id: "d", text: "Treat the outcome as already achieved and stop studying it." },
      ],
      answerId: "b",
      rationale: "Gaps are recorded as missing-explanation flags for plan revision, matching the confirmed plan's own coverage semantics; ignoring or hiding them leaves the plan wrong.",
    },
    {
      objectiveIndex: 2,
      sourcePosition: 1,
      prompt: `Which use of an AI coding assistant best serves the outcome "${objectiveSlot}" while keeping your own understanding verifiable against "${sourceSlot}"?`,
      choices: [
        { id: "a", text: "Accept every suggestion unread so the work finishes faster." },
        { id: "b", text: "Ask the assistant to explain each suggestion, then verify the explanation against the source before using it." },
        { id: "c", text: "Have the assistant rewrite the outcome until the task feels easy." },
        { id: "d", text: "Avoid assistants entirely, even for boilerplate you could check in seconds." },
      ],
      answerId: "b",
      rationale: "Delegating to an assistant while discerning and verifying its output against your own selected source keeps the evidence yours; unevaluated acceptance does not.",
    },
    {
      objectiveIndex: 2,
      sourcePosition: 0,
      prompt: `Your first practice attempt on the outcome "${objectiveSlot}" produced errors while working from "${sourceSlot}". What does that evidence mean here?`,
      choices: [
        { id: "a", text: "Errors prove the confirmed plan failed and should be discarded." },
        { id: "b", text: "Errors are evidence of what to restudy; this check records them with their uncertainty and nothing more." },
        { id: "c", text: "Errors mean the remaining check items should be skipped." },
        { id: "d", text: "Errors should be removed from the record before any export." },
      ],
      answerId: "b",
      rationale: "Typed diagnostic evidence records outcome and uncertainty honestly and creates no award; altering or discarding it would make the record misleading.",
    },
  ],
});

export type MaterializedItem = BundleItem & { objective: string; sourceRef: string };

// The bounded fixture supports confirmed plans with at least three outcomes and
// two acknowledged sources; anything less is Unavailable rather than relabeled.
export function checkSupportsBundle(plan: Plan, sources: { filename: string }[]) {
  return plan.outcomes.length >= 3 && sources.length >= 2;
}
export function materializeBundle(plan: Plan, sources: { filename: string }[]): MaterializedItem[] {
  if (!checkSupportsBundle(plan, sources)) fail("INVALID_INPUT");
  return syntheticCatalog.items.map(item => {
    const objective = plan.outcomes[item.objectiveIndex];
    const sourceRef = sources[item.sourcePosition]?.filename;
    if (!objective || !sourceRef) fail("INVALID_INPUT");
    const substitute = (template: string) => template.split(objectiveSlot).join(objective).split(sourceSlot).join(sourceRef);
    return {
      ...item,
      prompt: substitute(item.prompt),
      objective,
      sourceRef,
    };
  });
}

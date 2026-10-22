import { z } from "zod";
import { commandSchema } from "./setup";

// Typed setup-diagnostic contracts (S7 infrastructure subset). There are
// deliberately NO score, grade, completion, recovery or credit fields: the
// check records per-item evidence with outcome and uncertainty only, and
// unanswered items stay Unknown. Per-item answers and rationales are never
// part of any read model until that item has been submitted.

export const diagnosticSources = ["manual-synthetic"] as const;
export const assistances = ["unaided", "assisted"] as const;
export const itemOutcomes = ["correct", "incorrect", "unknown"] as const;
export const itemPaths = ["item-submit", "item-skip"] as const;

export const choiceSchema = z.strictObject({
  id: z.string().trim().min(1).max(8),
  text: z.string().trim().min(1).max(400),
});
export const bundleItemSchema = z
  .strictObject({
    objectiveIndex: z.number().int().min(0).max(7),
    sourcePosition: z.number().int().min(0).max(9),
    prompt: z.string().trim().min(1).max(1200),
    choices: z.array(choiceSchema).min(2).max(4),
    answerId: z.string().trim().min(1).max(8),
    rationale: z.string().trim().min(1).max(800),
  })
  .refine(item => item.choices.some(choice => choice.id === item.answerId), {
    message: "The declared answer must match a declared choice.",
  })
  .refine(item => new Set(item.choices.map(choice => choice.id)).size === item.choices.length, {
    message: "Choice ids must be unique.",
  });
export const bundleCatalogSchema = z.strictObject({
  source: z.enum(diagnosticSources),
  items: z.array(bundleItemSchema).min(3).max(5),
});

export const takeCheckSchema = commandSchema;
export const skipCheckSchema = commandSchema;
export const submitItemSchema = commandSchema.extend({
  position: z.number().int().min(1).max(5),
  // Omitted choiceId records the item-skip path (unanswered stays Unknown);
  // a present choiceId must match a declared choice at submission time.
  choiceId: z.string().trim().min(1).max(8).optional(),
  assistance: z.enum(assistances),
});
export const finishCheckSchema = commandSchema;
export const flagItemSchema = commandSchema.extend({
  position: z.number().int().min(1).max(5),
});

export type DiagnosticChoice = z.infer<typeof choiceSchema>;
export type BundleItem = z.infer<typeof bundleItemSchema>;
export type BundleCatalog = z.infer<typeof bundleCatalogSchema>;
export type SubmitItem = z.infer<typeof submitItemSchema>;
export type FlagItem = z.infer<typeof flagItemSchema>;
export type DiagnosticSource = (typeof diagnosticSources)[number];
export type Assistance = (typeof assistances)[number];
export type ItemOutcome = (typeof itemOutcomes)[number];
export type ItemPath = (typeof itemPaths)[number];

// Read models. `evidence` is null until that item is submitted; unsubmitted
// items expose no answer, rationale or outcome beyond Unknown.
export type ItemEvidenceView = {
  choiceId: string | null;
  outcome: ItemOutcome;
  correctChoiceId: string | null;
  rationale: string | null;
  assistance: Assistance;
  unclear: boolean;
  path: ItemPath;
};
export type CheckItemView = {
  position: number;
  prompt: string;
  objective: string;
  sourceRef: string;
  choices: DiagnosticChoice[];
  evidence: ItemEvidenceView | null;
};
export type CheckState = {
  rootId: string;
  revision: number;
  synthetic: true;
  source: DiagnosticSource;
  status: "no-confirmed-plan" | "offered" | "unavailable" | "active" | "finished";
  historical: boolean;
  bundleId: string | null;
  planId: string | null;
  confirmedPlanId: string | null;
  items: CheckItemView[];
  submittedCount: number;
  unknownCount: number;
  skipRecorded: boolean;
  finishRecorded: boolean;
};
// Returned only after that item's submission; this is the sole reveal path.
export type SubmittedItem = {
  rootId: string;
  revision: number;
  position: number;
  outcome: ItemOutcome;
  correctChoiceId: string | null;
  rationale: string | null;
  objective: string;
  sourceRef: string;
};
export type CheckSkip = { rootId: string; revision: number; path: "check-skip" };
export type CheckFinish = { rootId: string; bundleId: string; revision: number; path: "check-finish"; submitted: number; unknown: number };
export type CheckFlag = { rootId: string; bundleId: string; revision: number; position: number; unclear: true };
export type TakenCheck = { rootId: string; bundleId: string; revision: number };

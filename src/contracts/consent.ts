import { z } from "zod";
import { commandSchema, uuid } from "./setup";

// S3 consent/policy-admission contracts. Disclosure (configuration) and owner
// consent (decisions) are separate axes; a submitted preference can never make
// an ineligible configuration dispatchable.
export const decisionStates = ["none", "granted", "declined", "withdrawn"] as const;
export type DecisionState = typeof decisionStates[number];

// Consent is explicit: no preselection, an exact current disclosure version and
// a literal terms acknowledgment. Grants against stale versions fail with
// CONFLICT so changed processor/purpose/categories/retention always re-consent.
export const decideSchema = commandSchema.extend({
  configurationVersion: z.number().int().positive(),
  decision: z.enum(["granted", "declined"]),
  acknowledgedTerms: z.literal(true),
});
export type Decide = z.infer<typeof decideSchema>;

export const withdrawSchema = commandSchema;
export type Withdraw = z.infer<typeof withdrawSchema>;

// Content-free dispatch scope: scoped lineage object IDs and the caller's
// dispatch command key only. Excerpts, rosters and unnecessary identifiers are
// rejected by the bounded shape before admission runs.
export const dispatchScopeSchema = z.strictObject({
  commandKey: uuid,
  objectIds: z.array(uuid).min(1).max(16),
});
export type DispatchScope = z.infer<typeof dispatchScopeSchema>;

export const admissionOutcomes = [
  "admitted",
  "rejected-late",
  "blocked-ineligible",
  "blocked-consent",
  "blocked-withdrawn",
  "blocked-fence",
  "blocked-quota",
] as const;
export type AdmissionOutcome = typeof admissionOutcomes[number];

export const settleOutcomes = ["accepted", "rejected-late"] as const;
export type SettleOutcome = typeof settleOutcomes[number];

// The pinned public disclosure state: other packages read this exact shape.
export const disclosureSchema = z.strictObject({
  configuration: z.strictObject({
    version: z.number().int().positive(),
    provider: z.string().min(1),
    purpose: z.string().min(1),
    categories: z.array(z.string().min(1)).min(1),
    retentionNotice: z.string().min(1),
    eligibility: z.enum(["eligible", "ineligible"]),
    syntheticTest: z.boolean(),
  }),
  decision: z.enum(decisionStates),
});
export type Disclosure = z.infer<typeof disclosureSchema>;

export const decisionReceiptSchema = z.strictObject({
  decision: z.enum(["granted", "declined", "withdrawn"]),
  disclosureVersion: z.number().int().positive(),
});
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;

export type DecisionRow = {
  decision: "granted" | "declined" | "withdrawn";
  disclosure_version: number;
  decided_at: string | Date;
};

// Pure decision derivation: the latest row by decided time wins; a grant or
// decline recorded against an older disclosure no longer answers the current
// one (re-consent is required), while a withdrawal stays withdrawn regardless
// of later disclosures.
export function currentDecisionState(rows: DecisionRow[], version: number): DecisionState {
  const latest = rows
    .slice()
    .sort((a, b) => {
      const time = new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime();
      return time || b.disclosure_version - a.disclosure_version;
    })[0];
  if (!latest) return "none";
  if (latest.decision === "withdrawn") return "withdrawn";
  return latest.disclosure_version === version ? latest.decision : "none";
}

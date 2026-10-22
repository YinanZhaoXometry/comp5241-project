import { z } from "zod";
import { commandSchema, goals } from "./setup";

// S4 setup-preferences contract. The GET /preferences response shape is pinned
// for sibling packages: {stage, goal, topic, clarification, background,
// timePreference, timezone, revision}. `revision` mirrors the monotonic
// app.setup_preference.revision column other packages read for conflict
// detection of plan-relevant goal/topic/clarification changes.
export const stages = ["materials", "goal", "plan", "check"] as const;
export const timePreferences = ["morning", "afternoon", "evening", "flexible"] as const;
export type Stage = (typeof stages)[number];
export type Goal = (typeof goals)[number];
export type TimePreference = (typeof timePreferences)[number];

// Canonical IANA zones only; aliases are rejected the same way as inventions.
// Node/V8's supportedValuesOf omits the spec's special "UTC" value and the
// Etc/* identifiers even though resolvedOptions().timeZone may legitimately
// return them, so the platform's own detected zone is also accepted — a
// detected default must always be saveable; invented zones stay rejected.
const timeZones = new Set(Intl.supportedValuesOf("timeZone"));
timeZones.add("UTC");
try { timeZones.add(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* no zone detectable; list still applies */ }
export function validTimeZone(zone: string): boolean {
  return timeZones.has(zone);
}

export const savePreferencesSchema = commandSchema
  .extend({
    stage: z.enum(stages),
    goal: z.enum(goals).nullable(),
    topic: z.string().trim().max(160),
    clarification: z.string().trim().max(240),
    background: z.string().trim().max(400),
    timePreference: z.enum(timePreferences).nullable(),
    timezone: z.string().trim().max(64),
  })
  .refine((value) => value.goal === "Other" || value.clarification === "", {
    path: ["clarification"],
    message: "Only Other takes a short clarification.",
  })
  .refine((value) => value.goal !== "Other" || value.clarification.length > 0, {
    path: ["clarification"],
    message: "Add a short clarification for Other.",
  })
  .refine((value) => value.timezone === "" || validTimeZone(value.timezone), {
    path: ["timezone"],
    message: "Enter a valid IANA timezone.",
  });

export type Preferences = {
  stage: Stage;
  goal: Goal | null;
  topic: string;
  clarification: string;
  background: string;
  timePreference: TimePreference | null;
  timezone: string;
  revision: number;
};
export type SavePreferences = z.infer<typeof savePreferencesSchema>;

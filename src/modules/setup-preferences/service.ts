import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { savePreferencesSchema, type Preferences, type SavePreferences } from "../../contracts/preferences";
import type { Identity } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import { fail } from "../../platform/errors";
import * as repository from "./repository";

// Local copies of the shared command helpers: this module is deliberately
// self-contained (no import from materials-setup) so wave-1 packages cannot
// break each other; the S11 sweep may consolidate them later.
export function requestHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function parse<T>(parser: { parse: (value: unknown) => T }, value: unknown): T {
  try { return parser.parse(value); } catch (error) { if (error instanceof ZodError) fail("INVALID_INPUT"); throw error; }
}

export function emptyPreferences(): Preferences {
  return { stage: "materials", goal: null, topic: "", clarification: "", background: "", timePreference: null, timezone: "", revision: 0 };
}

function mapRow(row: repository.SetupPreferenceRow): Preferences {
  return { stage: row.stage as Preferences["stage"], goal: row.goal as Preferences["goal"], topic: row.topic, clarification: row.clarification, background: row.background, timePreference: row.time_preference as Preferences["timePreference"], timezone: row.timezone, revision: row.revision };
}

export async function getPreferences(identity: Identity): Promise<Preferences> {
  return transaction(async client => {
    const principal = await authorize(client, identity);
    if (principal.role !== "learner") fail("FORBIDDEN_OR_NOT_FOUND");
    const row = await repository.preferenceRow(client, identity.userId);
    return row ? mapRow(row) : emptyPreferences();
  });
}

export async function savePreferences(identity: Identity, raw: SavePreferences): Promise<Preferences> {
  const command = parse(savePreferencesSchema, raw);
  return transaction(async client => {
    const principal = await authorize(client, identity);
    if (principal.role !== "learner") fail("FORBIDDEN_OR_NOT_FOUND");
    const hash = requestHash(command);
    const current = await repository.preferenceRow(client, identity.userId);
    // Row-scoped idempotent replay: the row keeps the last accepted command.
    // A genuine lost-response retry (same command key and bytes) returns the
    // stored committed result exactly once; the same key with different bytes
    // is a replay misuse. A later command overwrites the stored key, after
    // which the retry falls through to the expectedRevision check below and
    // CONFLICTs instead of misreporting another command's state as its result.
    // (Deviation from app.command_receipt recorded in the leaf ticket:
    // command_receipt.root_id requires a lifecycle root, which root-less
    // owner preferences do not have.)
    if (current?.command_key === command.commandKey) {
      if (current.request_hash !== hash || !current.result) fail("CONFLICT");
      return current.result;
    }
    const revision = current?.revision ?? 0;
    if (revision !== command.expectedRevision) fail("CONFLICT");
    // `revision` is the pinned column other packages read: it advances only on
    // plan-relevant intent changes (goal/topic/clarification) so a previously
    // confirmed draft can no longer be confirmed against stale intent, while
    // optional preference or stage navigation never invalidates confirmation.
    const relevant = !current || current.goal !== command.goal || current.topic !== command.topic || current.clarification !== command.clarification;
    const nextRevision = relevant ? revision + 1 : revision;
    const saved: Preferences = { stage: command.stage, goal: command.goal, topic: command.topic, clarification: command.clarification, background: command.background, timePreference: command.timePreference, timezone: command.timezone, revision: nextRevision };
    await repository.upsertPreference(client, identity.userId, command, nextRevision, command.commandKey, hash, saved);
    return saved;
  });
}

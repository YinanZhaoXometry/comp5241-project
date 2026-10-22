import type { PoolClient } from "pg";
import { uuid, type Command, type Identity } from "../../contracts/setup";
import {
  takeCheckSchema,
  skipCheckSchema,
  submitItemSchema,
  finishCheckSchema,
  flagItemSchema,
  type CheckFinish,
  type CheckFlag,
  type CheckItemView,
  type CheckSkip,
  type CheckState,
  type ItemOutcome,
  type ItemPath,
  type FlagItem,
  type SubmitItem,
  type SubmittedItem,
  type TakenCheck,
} from "../../contracts/diagnostic";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { batchRow } from "../materials-setup/batches";
import { planRevision } from "../materials-setup/repository";
import { parse, requestHash } from "../../platform/commands";
import { fail } from "../../platform/errors";
import { checkSupportsBundle, materializeBundle } from "./bundle";
import * as repository from "./repository";

// S7 infrastructure subset: an optional starting check offered equally with
// "Skip for now" from a confirmed plan. Items come from the manually authored
// synthetic bundle pinned to the exact confirmed plan revision — never from a
// generator (S6 is blocked, so the take-path acceptance stays open). Per-item
// answers and rationales are withheld until that item's submission, unanswered
// items stay Unknown, and no path here creates completion credit, scores,
// recovery or scored-course semantics.

async function batchRevision(client: PoolClient, rootId: string) {
  return batchRow(client, rootId);
}

async function currentState(client: PoolClient, identity: Identity, rootId: string, overrideBundleId?: string): Promise<CheckState> {
  const batch = (await client.query<{ revision: number; confirmed_id: string | null }>("SELECT revision,confirmed_id FROM app.study_batch WHERE id=$1", [rootId])).rows[0];
  const revision = batch?.revision ?? 0;
  const confirmedPlanId = batch?.confirmed_id ?? null;
  // A broken confirmed lineage (e.g. a selected source was deleted) denies the
  // state read outright — a check view never outlives its confirmed lineage.
  // Deletion clears confirmed_id, so a cleared pointer with existing check
  // bundles is still a deletion, never an unconfirmed study.
  if (confirmedPlanId) await lifecycle.assertObjects(client, identity.userId, [confirmedPlanId]);
  else if (await repository.latestBundle(client, rootId)) fail("FORBIDDEN_OR_NOT_FOUND");
  const current = confirmedPlanId ? await repository.bundleByPlan(client, confirmedPlanId) : null;
  const shown = overrideBundleId ? await repository.bundleById(client, rootId, overrideBundleId) : current;
  if (overrideBundleId && !shown) fail("FORBIDDEN_OR_NOT_FOUND");
  // Deletion invalidates the bundle through its plan lineage; exposed items
  // deny reads exactly like other derivatives (the explicit bundle view has
  // already asserted the same fence).
  if (shown && !overrideBundleId) await lifecycle.assertObjects(client, identity.userId, [shown.id]);
  const latest = current ? null : await repository.latestBundle(client, rootId);
  // Evidence on an earlier confirmed plan revision stays historical: it is
  // viewable through the explicit bundle view but never accepts submissions,
  // and the current view notes it while offering the new revision's check.
  const historical = overrideBundleId
    ? !!shown && shown.plan_id !== confirmedPlanId
    : !current && !!latest && latest.plan_id !== confirmedPlanId;
  let status: CheckState["status"];
  let items: CheckItemView[] = [];
  if (!shown) {
    if (!confirmedPlanId) {
      status = "no-confirmed-plan";
    } else {
      const confirmed = await planRevision(client, confirmedPlanId);
      status = confirmed && checkSupportsBundle(confirmed.plan, confirmed.sources) ? "offered" : "unavailable";
    }
  } else {
    status = (await repository.receiptExists(client, identity.userId, rootId, "finish-check", { bundleId: shown.id })) ? "finished" : "active";
    const rows = await repository.itemsForBundle(client, shown.id);
    const evidence = await repository.evidenceForBundle(client, shown.id);
    const byItem = new Map(evidence.map(record => [record.item_id, record]));
    items = rows.map(row => ({
      position: row.position,
      prompt: row.prompt,
      objective: row.objective,
      sourceRef: row.source_ref,
      choices: row.choices,
      // Sole reveal path: answer and rationale appear only for a submitted
      // item; a skipped item keeps them withheld and its outcome is Unknown.
      evidence: (() => {
        const record = byItem.get(row.id);
        if (!record) return null;
        const revealed = record.path === "item-submit";
        return {
          choiceId: record.choice_id,
          outcome: record.outcome,
          correctChoiceId: revealed ? row.answer_id : null,
          rationale: revealed ? row.rationale : null,
          assistance: record.assistance,
          unclear: record.unclear,
          path: record.path,
        };
      })(),
    }));
  }
  const submittedCount = items.filter(item => item.evidence?.path === "item-submit").length;
  return {
    rootId,
    revision,
    synthetic: true,
    source: "manual-synthetic",
    status,
    historical,
    bundleId: shown?.id ?? null,
    planId: shown?.plan_id ?? null,
    confirmedPlanId,
    items,
    submittedCount,
    unknownCount: items.length - submittedCount,
    skipRecorded: await repository.receiptExists(client, identity.userId, rootId, "skip-check"),
    finishRecorded: shown ? await repository.receiptExists(client, identity.userId, rootId, "finish-check", { bundleId: shown.id }) : false,
  };
}

export async function getCheckState(identity: Identity, rawId: string) {
  const rootId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    return currentState(client, identity, rootId);
  });
}

// Historical view of one specific bundle (an earlier confirmed plan revision).
export async function getBundleState(identity: Identity, rawId: string, rawBundleId: string) {
  const rootId = parse(uuid, rawId);
  const bundleId = parse(uuid, rawBundleId);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    await lifecycle.assertObjects(client, identity.userId, [bundleId]);
    return currentState(client, identity, rootId, bundleId);
  });
}

export async function takeCheck(identity: Identity, rawId: string, raw: Command): Promise<TakenCheck> {
  const rootId = parse(uuid, rawId);
  const command = parse(takeCheckSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRevision(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "take-check", hash);
    if (repeated) return repeated as unknown as TakenCheck;
    if (!batch.confirmed_id) fail("CONFLICT"); // offered only from a confirmed plan
    await lifecycle.assertObjects(client, identity.userId, [batch.confirmed_id]);
    const confirmed = await planRevision(client, batch.confirmed_id);
    if (!confirmed) fail("CONFLICT");
    // Unsupported links stay Unavailable (skip still finishes setup); items
    // are never renumbered or fabricated to fit the plan.
    const materialized = materializeBundle(confirmed.plan, confirmed.sources);
    const bundleId = await repository.registerDiagnosticObject(client, rootId, [batch.confirmed_id]);
    await repository.insertBundle(client, bundleId, rootId, batch.confirmed_id, materialized.length);
    for (const [index, item] of materialized.entries()) await repository.insertItem(client, crypto.randomUUID(), bundleId, index + 1, item);
    const result: TakenCheck = { rootId, bundleId, revision: batch.revision };
    await lifecycle.receipt(client, identity, command, "take-check", hash, result);
    return result;
  });
}

export async function skipCheck(identity: Identity, rawId: string, raw: Command): Promise<CheckSkip> {
  const rootId = parse(uuid, rawId);
  const command = parse(skipCheckSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRevision(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "skip-check", hash);
    if (repeated) return repeated as unknown as CheckSkip;
    const result: CheckSkip = { rootId, revision: batch.revision, path: "check-skip" };
    if (await repository.receiptExists(client, identity.userId, rootId, "skip-check")) return result;
    await lifecycle.receipt(client, identity, command, "skip-check", hash, result);
    return result;
  });
}

export async function submitItem(identity: Identity, rawId: string, rawBundleId: string, raw: SubmitItem): Promise<SubmittedItem> {
  const rootId = parse(uuid, rawId);
  const bundleId = parse(uuid, rawBundleId);
  const command = parse(submitItemSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRevision(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, bundleId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "submit-item", hash);
    if (repeated) return repeated as unknown as SubmittedItem;
    const bundle = await repository.bundleById(client, rootId, bundleId);
    if (!bundle) fail("FORBIDDEN_OR_NOT_FOUND");
    // A check accepts submissions only against its own still-confirmed
    // revision; after a re-confirmation the old bundle is historical.
    if (bundle.plan_id !== batch.confirmed_id) fail("CONFLICT");
    await lifecycle.assertObjects(client, identity.userId, [bundleId]);
    const item = await repository.itemByPosition(client, bundleId, command.position);
    if (!item) fail("INVALID_INPUT");
    if (command.choiceId && !item.choices.some(choice => choice.id === command.choiceId)) fail("INVALID_INPUT");
    const existing = await repository.evidenceForItem(client, bundleId, item.id);
    if (existing && (existing.choice_id ?? null) !== (command.choiceId ?? null)) fail("CONFLICT"); // recorded answers and skips never change
    const record = existing ?? await recordEvidence(client, identity, bundle, item, command);
    const revealed = record.path === "item-submit";
    const result: SubmittedItem = {
      rootId,
      revision: batch.revision,
      position: command.position,
      outcome: record.outcome,
      correctChoiceId: revealed ? item.answer_id : null,
      rationale: revealed ? item.rationale : null,
      objective: item.objective,
      sourceRef: item.source_ref,
    };
    await lifecycle.receipt(client, identity, command, "submit-item", hash, result);
    return result;
  });
}

async function recordEvidence(client: PoolClient, identity: Identity, bundle: repository.BundleRow, item: repository.ItemRow, command: SubmitItem) {
  const outcome: ItemOutcome = command.choiceId ? (command.choiceId === item.answer_id ? "correct" : "incorrect") : "unknown";
  const path: ItemPath = command.choiceId ? "item-submit" : "item-skip";
  const inserted = await repository.insertEvidence(client, crypto.randomUUID(), {
    bundleId: bundle.id,
    itemId: item.id,
    ownerId: identity.userId,
    rootId: bundle.root_id,
    planId: bundle.plan_id,
    position: command.position,
    choiceId: command.choiceId ?? null,
    outcome,
    assistance: command.assistance,
    path,
  });
  if (!inserted) {
    // A concurrent different-key submission committed first for this item.
    const winner = await repository.evidenceForItem(client, bundle.id, item.id);
    if (!winner || (winner.choice_id ?? null) !== (command.choiceId ?? null)) fail("CONFLICT");
    return winner;
  }
  const row = await repository.evidenceForItem(client, bundle.id, item.id);
  if (!row) fail("RETRYABLE_FAILURE");
  return row;
}

export async function finishCheck(identity: Identity, rawId: string, rawBundleId: string, raw: Command): Promise<CheckFinish> {
  const rootId = parse(uuid, rawId);
  const bundleId = parse(uuid, rawBundleId);
  const command = parse(finishCheckSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRevision(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, bundleId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "finish-check", hash);
    if (repeated) return repeated as unknown as CheckFinish;
    const bundle = await repository.bundleById(client, rootId, bundleId);
    if (!bundle) fail("FORBIDDEN_OR_NOT_FOUND");
    if (bundle.plan_id !== batch.confirmed_id) fail("CONFLICT");
    await lifecycle.assertObjects(client, identity.userId, [bundleId]);
    const rows = await repository.itemsForBundle(client, bundleId);
    const evidence = await repository.evidenceForBundle(client, bundleId);
    const submitted = evidence.filter(record => record.path === "item-submit").length;
    // Finishing leaves remaining items Unknown; it is a distinct recorded
    // path and never certifies a result or grants any credit.
    const result: CheckFinish = { rootId, bundleId, revision: batch.revision, path: "check-finish", submitted, unknown: rows.length - submitted };
    if (await repository.receiptExists(client, identity.userId, rootId, "finish-check", { bundleId })) return result;
    await lifecycle.receipt(client, identity, command, "finish-check", hash, result);
    return result;
  });
}

export async function flagUnclear(identity: Identity, rawId: string, rawBundleId: string, raw: FlagItem): Promise<CheckFlag> {
  const rootId = parse(uuid, rawId);
  const bundleId = parse(uuid, rawBundleId);
  const command = parse(flagItemSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRevision(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, bundleId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "flag-item", hash);
    if (repeated) return repeated as unknown as CheckFlag;
    const bundle = await repository.bundleById(client, rootId, bundleId);
    if (!bundle) fail("FORBIDDEN_OR_NOT_FOUND");
    if (bundle.plan_id !== batch.confirmed_id) fail("CONFLICT");
    await lifecycle.assertObjects(client, identity.userId, [bundleId]);
    const item = await repository.itemByPosition(client, bundleId, command.position);
    if (!item) fail("INVALID_INPUT");
    const existing = await repository.evidenceForItem(client, bundleId, item.id);
    if (!existing || existing.path !== "item-submit") fail("CONFLICT"); // only a submitted answer can be flagged unclear
    await repository.markUnclear(client, identity.userId, bundleId, item.id);
    const result: CheckFlag = { rootId, bundleId, revision: batch.revision, position: command.position, unclear: true };
    if (await repository.receiptExists(client, identity.userId, rootId, "flag-item", { bundleId, position: command.position })) return result;
    await lifecycle.receipt(client, identity, command, "flag-item", hash, result);
    return result;
  });
}

import { commandSchema, uuid, type Identity, type Receipt } from "../../contracts/setup";
import type { AiDraftView } from "../../contracts/ai-setup";
import { transaction } from "../../adapters/postgres/database";
import { enqueueAiDraft } from "../../adapters/queue";
import { AI_BUDGET } from "../../adapters/ai-live";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { admitDispatch } from "../processing-consent/service";
import { getBatch, batchRow } from "../materials-setup/batches";
import { fail } from "../../platform/errors";
import { parse, requestHash } from "../../platform/commands";
import * as repository from "./repository";

// Learner action: authorize, load the study through the existing read paths
// (an acknowledged selection with extracted sources is required), admit the
// dispatch through the EXISTING consent machinery, pre-check the owner's
// budget ledger, then enqueue one bounded worker job. The provider is never
// called here — only the worker dispatches, and only after the settlement
// fences still hold.
export async function requestAiDraft(identity: Identity, rawId: string, raw: unknown): Promise<Receipt> {
  const rootId = parse(uuid, rawId);
  const command = parse(commandSchema, raw);
  const batch = await getBatch(identity, rootId);
  const outcome = await transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "request-ai-draft", hash);
    if (repeated) return repeated;
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    const selection = batch.selection;
    if (!selection || !selection.sources.length || selection.sources.some(source => !source.extractionId)) fail("CONFLICT");
    // Admission fence scope: the exact acknowledged selection plus every
    // selected extraction revision (bounded by the ten-slot batch limit).
    const objectIds = [selection.id, ...selection.sources.map(source => source.extractionId)];
    const admission = await admitDispatch(client, identity, { commandKey: command.commandKey, objectIds });
    if (admission.outcome !== "admitted") return { blocked: admission.outcome } as const;
    // Budget pre-check (untrusted provider-claimed ledger + this request's
    // maximum output): exhausted means nothing is dispatched and nothing is
    // recorded — the transaction rolls back including the admission.
    const ledger = await repository.ledgerTotalTokens(client, identity.userId);
    if (ledger + AI_BUDGET.maxOutputTokens > AI_BUDGET.totalTokenCap) fail("AI_BUDGET_EXHAUSTED");
    const requestId = crypto.randomUUID();
    await repository.insertDraftRequest(client, { id: requestId, rootId, ownerId: identity.userId, admissionId: admission.admissionId, kind: "plan" });
    await enqueueAiDraft(client, { schemaVersion: 1, requestId, admissionId: admission.admissionId, rootId, ownerId: identity.userId, sessionId: identity.sessionId, kind: "plan" });
    return lifecycle.receipt(client, identity, command, "request-ai-draft", hash, { rootId, operationId: requestId, selectionId: selection.id, revision: item.revision, state: "pending" });
  });
  if ("blocked" in outcome)
    fail(outcome.blocked === "blocked-quota" ? "RATE_LIMITED" : "FORBIDDEN_OR_NOT_FOUND");
  return outcome;
}

// Owner-scoped read of the latest advisory request of one kind for a study. The
// returned objectIds are the admission's pinned lineage: the route's protected
// response re-checks them per chunk, so an invalidated or deleted source denies
// the read exactly like every other protected view.
export async function getAiDraft(identity: Identity, rawId: string, kind: "plan" | "check" = "plan"): Promise<AiDraftView> {
  const rootId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const row = await repository.draftByRoot(client, identity.userId, rootId, kind);
    if (!row) fail("FORBIDDEN_OR_NOT_FOUND");
    return {
      requestId: row.id,
      rootId: row.root_id,
      kind: row.kind,
      status: row.status,
      failureCode: row.failure_code,
      result: row.result,
      model: row.model,
      usage: row.usage,
      objectIds: row.object_ids ?? [],
      createdAt: row.created_at.toISOString(),
      settledAt: row.settled_at?.toISOString() ?? null,
    };
  });
}

// S7 take-path closure: request AI generation of the 3–5-item starting check.
// Requires a CONFIRMED plan (the check is offered from confirmation, never
// before); the admission fence pins the selection, its extractions and the
// confirmed plan revision itself, so any change discards the result.
export async function requestAiCheck(identity: Identity, rawId: string, raw: unknown): Promise<Receipt> {
  const rootId = parse(uuid, rawId);
  const command = parse(commandSchema, raw);
  const batch = await getBatch(identity, rootId);
  const outcome = await transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, kind: "check", command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "request-ai-check", hash);
    if (repeated) return repeated;
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    if (!item.confirmed_id) fail("CONFLICT"); // offered only from a confirmed plan
    const selection = batch.selection;
    if (!selection || !selection.sources.length || selection.sources.some(source => !source.extractionId)) fail("CONFLICT");
    const objectIds = [selection.id, ...selection.sources.map(source => source.extractionId), item.confirmed_id];
    const admission = await admitDispatch(client, identity, { commandKey: command.commandKey, objectIds });
    if (admission.outcome !== "admitted") return { blocked: admission.outcome } as const;
    const ledger = await repository.ledgerTotalTokens(client, identity.userId);
    if (ledger + AI_BUDGET.maxOutputTokens > AI_BUDGET.totalTokenCap) fail("AI_BUDGET_EXHAUSTED");
    const requestId = crypto.randomUUID();
    await repository.insertDraftRequest(client, { id: requestId, rootId, ownerId: identity.userId, admissionId: admission.admissionId, kind: "check" });
    await enqueueAiDraft(client, { schemaVersion: 1, requestId, admissionId: admission.admissionId, rootId, ownerId: identity.userId, sessionId: identity.sessionId, kind: "check" });
    return lifecycle.receipt(client, identity, command, "request-ai-check", hash, { rootId, operationId: requestId, selectionId: selection.id, revision: item.revision, state: "pending" });
  });
  if ("blocked" in outcome)
    fail(outcome.blocked === "blocked-quota" ? "RATE_LIMITED" : "FORBIDDEN_OR_NOT_FOUND");
  return outcome;
}


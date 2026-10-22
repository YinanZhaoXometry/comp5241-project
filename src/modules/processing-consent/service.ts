import { createHash } from "node:crypto";
import { ZodError } from "zod";
import type { PoolClient } from "pg";
import {
  decideSchema,
  withdrawSchema,
  dispatchScopeSchema,
  disclosureSchema,
  currentDecisionState,
  type AdmissionOutcome,
  type DecisionReceipt,
  type Disclosure,
  type DispatchScope,
  type SettleOutcome,
} from "../../contracts/consent";
import { uuid, type Identity } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import { objectsActive } from "../lifecycle-platform/repository";
import { fail } from "../../platform/errors";
import { deliverPendingJournalEvents, journalConsentWithdrawal } from "../../adapters/protected-journal";
import * as repository from "./repository";

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function parse<T>(parser: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return parser.parse(value);
  } catch (error) {
    if (error instanceof ZodError) fail("INVALID_INPUT");
    throw error;
  }
}

// Pinned public disclosure state (other packages read this exact shape).
export async function getDisclosure(identity: Identity): Promise<Disclosure> {
  return transaction(async (client) => {
    await authorize(client, identity);
    const configuration = await repository.currentConfiguration(client);
    if (!configuration) fail("RETRYABLE_FAILURE");
    const rows = await repository.decisionRows(client, identity.userId);
    return disclosureSchema.parse({
      configuration: {
        version: configuration.version,
        provider: configuration.provider,
        purpose: configuration.purpose,
        categories: configuration.categories,
        retentionNotice: configuration.retention_notice,
        eligibility: configuration.eligibility,
        syntheticTest: configuration.synthetic_test,
      },
      decision: currentDecisionState(rows, configuration.version),
    });
  });
}

// Explicit consent decision. A grant is only accepted against the current
// eligible disclosure; an ineligible configuration stays blocked no matter what
// the client submits. Declining has no external effect and loses no saved work.
export async function decide(identity: Identity, raw: unknown): Promise<DecisionReceipt> {
  const command = parse(decideSchema, raw);
  const hash = requestHash({
    configurationVersion: command.configurationVersion,
    decision: command.decision,
    acknowledgedTerms: command.acknowledgedTerms,
  });
  return transaction(async (client) => {
    // authorize() row-locks the principal, serializing decisions, withdrawals
    // and admissions onto one order.
    await authorize(client, identity);
    const repeated = await repository.decisionByKey(client, identity.userId, command.commandKey);
    if (repeated) {
      if (repeated.request_hash !== hash) fail("CONFLICT");
      return { decision: repeated.decision, disclosureVersion: repeated.disclosure_version };
    }
    // Withdrawal is a terminal protective state for this owner: it blocks every
    // later dispatch and cannot be silently reversed by a new grant. The way
    // back runs through deletion/re-provisioning flows, not this endpoint.
    const latest = (await repository.decisionRows(client, identity.userId))[0];
    if (latest?.decision === "withdrawn") fail("CONFLICT");
    const configuration = await repository.currentConfiguration(client);
    if (!configuration || configuration.version !== command.configurationVersion) fail("CONFLICT");
    if (command.decision === "granted" && configuration.eligibility !== "eligible")
      fail("FORBIDDEN_OR_NOT_FOUND");
    await repository.insertDecision(
      client,
      identity.userId,
      command.commandKey,
      configuration.id,
      configuration.version,
      command.decision,
      hash,
      identity.sessionId,
    );
    return { decision: command.decision, disclosureVersion: configuration.version };
  });
}

// Withdrawal blocks every later dispatch immediately: admitDispatch reads the
// latest decision under the same principal row lock, so the two serialize. The
// durable withdrawn row is the protective journal; if recording it fails the
// transaction rolls back and the caller sees a retryable failure — never a
// success without durability.
export async function withdraw(identity: Identity, raw: unknown): Promise<DecisionReceipt> {
  const command = parse(withdrawSchema, raw);
  const hash = requestHash({ withdrawal: true });
  const result = await transaction(async (client) => {
    await authorize(client, identity);
    const repeated = await repository.decisionByKey(client, identity.userId, command.commandKey);
    if (repeated) {
      if (repeated.request_hash !== hash) fail("CONFLICT");
      return { decision: repeated.decision, disclosureVersion: repeated.disclosure_version };
    }
    const latest = (await repository.decisionRows(client, identity.userId))[0];
    if (!latest || latest.decision === "withdrawn") fail("CONFLICT");
    const configuration = await repository.currentConfiguration(client);
    if (!configuration) fail("RETRYABLE_FAILURE");
    await repository.insertDecision(
      client,
      identity.userId,
      command.commandKey,
      configuration.id,
      configuration.version,
      "withdrawn",
      hash,
      identity.sessionId,
    );
    // S13 hook: journal the withdrawal atomically — a failed append rolls the withdrawal back.
    await journalConsentWithdrawal(client, {
      ownerId: identity.userId,
      sessionId: identity.sessionId,
      receipt: {
        commandKey: command.commandKey,
        configurationId: configuration.id,
        disclosureVersion: configuration.version,
        requestHash: hash,
      },
    });
    return { decision: "withdrawn" as const, disclosureVersion: configuration.version };
  });
  // S13 hook: best-effort independent-store delivery; healed by the next delivery/backup.
  try { await transaction((client) => deliverPendingJournalEvents(client)); }
  catch { console.error(JSON.stringify({ event: "journal-delivery-pending" })); }
  return result;
}

// Admission runs INSIDE the caller's transaction, before any enqueue/dispatch.
// Order: session/scope (authorize), configuration eligibility, consent to the
// current disclosure, ancestor fences, configured quota. The recorded admission
// receipt is content-free (scoped IDs, purpose, outcome). Denied paths never
// throw for policy blocks: the caller branches on the returned outcome and only
// dispatches when it is 'admitted'.
export async function admitDispatch(
  client: PoolClient,
  identity: Identity,
  raw: unknown,
): Promise<{ admissionId: string; outcome: AdmissionOutcome }> {
  const scope: DispatchScope = parse(dispatchScopeSchema, raw);
  await authorize(client, identity);
  const configuration = await repository.currentConfiguration(client);
  if (!configuration) fail("RETRYABLE_FAILURE");
  const rows = await repository.decisionRows(client, identity.userId);
  const latest = rows[0];
  let outcome: AdmissionOutcome;
  if (configuration.eligibility !== "eligible") outcome = "blocked-ineligible";
  else if (latest?.decision === "withdrawn") outcome = "blocked-withdrawn";
  else if (!latest || latest.decision !== "granted" || latest.disclosure_version !== configuration.version)
    outcome = "blocked-consent";
  else if (!(await objectsActive(client, identity.userId, scope.objectIds))) outcome = "blocked-fence";
  else if ((await repository.admissionsToday(client, identity.userId)) >= configuration.daily_admission_limit)
    outcome = "blocked-quota";
  else outcome = "admitted";
  const admissionId = crypto.randomUUID();
  await repository.insertAdmission(client, {
    id: admissionId,
    ownerId: identity.userId,
    commandKey: scope.commandKey,
    configurationId: configuration.id,
    purpose: configuration.purpose,
    outcome,
    objectIds: scope.objectIds,
    sessionId: identity.sessionId,
  });
  return { admissionId, outcome };
}

// Late-result settlement. Re-checks fences and the withdrawal/consent state in
// a fresh serialized transaction: any change since dispatch — withdrawal,
// decline, a newer disclosure version, or an invalidated/deleted ancestor —
// rejects the result as late (its retained copies are already enumerated in the
// admission's object_ids for S9 purge). Idempotent: an already-settled
// admission replays its recorded outcome instead of producing a second effect.
export async function settleDispatch(
  identity: Identity,
  rawAdmissionId: string,
): Promise<{ admissionId: string; outcome: SettleOutcome }> {
  const admissionId = parse(uuid, rawAdmissionId);
  return transaction(async (client) => {
    await authorize(client, identity);
    const admission = await repository.scopedAdmission(client, identity.userId, admissionId);
    if (!admission) fail("FORBIDDEN_OR_NOT_FOUND");
    if (admission.settled_at)
      return { admissionId, outcome: admission.outcome === "rejected-late" ? "rejected-late" : "accepted" };
    const admitted = await repository.configurationById(client, admission.configuration_id);
    const current = await repository.currentConfiguration(client);
    const latest = (await repository.decisionRows(client, identity.userId))[0];
    const unchanged =
      !!admitted &&
      !!current &&
      admitted.version === current.version &&
      latest?.decision === "granted" &&
      latest.disclosure_version === current.version;
    // Only a still-admitted dispatch can have a result; blocked admissions have
    // nothing to accept and settle as rejected-late without changing their
    // recorded blocked outcome.
    const outcome: SettleOutcome =
      admission.outcome === "admitted" &&
      unchanged &&
      (await objectsActive(client, identity.userId, admission.object_ids))
        ? "accepted"
        : "rejected-late";
    const recorded =
      admission.outcome === "admitted" && outcome === "rejected-late" ? "rejected-late" : admission.outcome;
    await repository.settleAdmission(client, admissionId, recorded);
    return { admissionId, outcome };
  });
}

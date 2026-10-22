import type { PoolClient } from "pg";
import { uuid, type Identity, type Plan } from "../../contracts/setup";
import type { ExtractionMetadata, Format } from "../../contracts/documents";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import { assertObjects, scopedRoot } from "../lifecycle-platform/repository";
import { batchRow } from "./batches";
import { planRevision } from "./repository";
import { parse } from "../../platform/commands";
import { fail } from "../../platform/errors";

export type HandoffSource = {
  slotId: string;
  rootId: string;
  filename: string;
  format: Format;
  extractionId: string;
  metadata: ExtractionMetadata | null;
};

// Exact-revision handoff for epic 2: every identity below is read from immutable
// tables inside one transaction, never from the mutable latest-draft pointers.
export type Handoff = {
  rootId: string;
  planRevisionId: string;
  selectionId: string;
  extractionId: string;
  confirmedAt: string;
  provenance: "Manual";
  plan: Plan;
  sources: HandoffSource[];
  // Lifecycle objects the consumer's re-authorization must fence: confirmed plan
  // revision, acknowledged selection and every selected extraction revision.
  objectIds: string[];
};

// P2 pin (execution plan §3): `app.setup_preference` (004-setup-preferences.sql,
// PK owner_id, monotonic integer revision) is provisioned by a sibling package and
// is legitimately absent before that migration applies. Absence of the relation or
// of the owner's row reads as "no preference recorded": the stale-draft check is
// skipped, never failed. Only a real read error propagates.
export async function preferenceRevision(client: PoolClient, ownerId: string): Promise<number | null> {
  try {
    const row = await client.query<{ revision: number }>("SELECT revision FROM app.setup_preference WHERE owner_id=$1", [ownerId]);
    return row.rows[0]?.revision ?? null;
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

export async function getHandoff(identity: Identity, rawId: string) {
  const rootId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity);
    await scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    // Absent confirmation is a state conflict, not a missing study: the handoff
    // never returns a draft and never substitutes the latest revision. A cleared
    // pointer and a purged confirmed revision (source deletion cascades the plan
    // row) are the same actionable state: select sources and confirm again.
    if (!batch.confirmed_id) fail("CONFLICT");
    const confirmed = await planRevision(client, batch.confirmed_id);
    if (!confirmed || !confirmed.selectionId) fail("CONFLICT");
    const sources = (await client.query<HandoffSource>(`SELECT x.slot_id AS "slotId",x.root_id AS "rootId",b.filename,b.format,x.extraction_id AS "extractionId",e.metadata
      FROM app.selection_source x JOIN app.batch_slot b ON b.id=x.slot_id
      JOIN app.extraction_revision e ON e.id=x.extraction_id
      WHERE x.selection_id=$1 ORDER BY b.position`, [confirmed.selectionId])).rows;
    // Dead confirmed lineage — purged or still-invalidated-unpurged — is one
    // actionable state (U5): the plan needs updated sources and a new
    // confirmation, so it conflicts instead of substituting content. Ownership,
    // session and root-state denials above stay FORBIDDEN/UNAUTHENTICATED.
    const objectIds = [confirmed.id, confirmed.selectionId, ...sources.map(source => source.extractionId)];
    try { await assertObjects(client, identity.userId, objectIds); } catch { fail("CONFLICT"); }
    const confirmation = await client.query<{ confirmed_at: Date }>("SELECT confirmed_at FROM app.plan_confirmation WHERE plan_id=$1", [batch.confirmed_id]);
    if (!confirmation.rows[0]) fail("CONFLICT");
    return {
      rootId,
      planRevisionId: confirmed.id,
      selectionId: confirmed.selectionId,
      extractionId: confirmed.extractionId,
      confirmedAt: confirmation.rows[0].confirmed_at.toISOString(),
      provenance: confirmed.provenance,
      plan: confirmed.plan,
      sources,
      objectIds,
    };
  });
}

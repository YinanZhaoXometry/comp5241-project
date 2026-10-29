import type { PoolClient } from 'pg';

// Registered lifecycle ports (S9): every module that persists a derivative of
// study data registers a port so deletion can enumerate, deny and purge it
// before an accepted request returns. Ports are content-free: they never read,
// log or return material text, only counts and row effects.
//
// Module write ownership is preserved exactly like the purgeMaterial port in
// materials-setup: an owning module exports its own purge/deny helper and the
// coordinator calls it — the lifecycle module never invents writes into tables
// another module owns. The two built-in ports below stand in for tables whose
// owning modules (processing-consent, setup-diagnostic, setup-export) land at
// integration: they enumerate by the pinned table names, guard on absence
// because those migrations are not on this branch, and perform no blind writes.
// A failing deny never restores access: lineage invalidation has already
// committed, and the reconciler retries port deny/purge until it succeeds.

export type DeletionScope = {
  ownerId: string;
  rootIds: string[];
  objectIds: string[];
  personal: boolean;
};
export type PortCategory = { key: string; label: string; count: number };
export type LifecyclePort = {
  name: string;
  label: string;
  /** Content-free counts of this derivative inside the deletion scope. */
  preview(client: PoolClient, scope: DeletionScope): Promise<PortCategory[]>;
  /** Cancel/deny future use of registered derivatives. Idempotent. */
  deny(client: PoolClient, scope: DeletionScope): Promise<void>;
  /** Erase registered active copies after revocation is durable. Idempotent. */
  purge(client: PoolClient, scope: DeletionScope): Promise<void>;
};

const ports: LifecyclePort[] = [];
export function registerLifecyclePort(port: LifecyclePort) {
  if (ports.some(registered => registered.name === port.name))
    throw new Error(`Duplicate lifecycle port: ${port.name}`);
  ports.push(port);
}
/** Test/integration replacement hook; production modules register once. */
export function unregisterLifecyclePort(name: string) {
  const index = ports.findIndex(registered => registered.name === name);
  if (index >= 0) ports.splice(index, 1);
}
export function registeredPorts(): readonly LifecyclePort[] {
  return ports;
}

export async function previewDerivatives(
  client: PoolClient,
  scope: DeletionScope,
): Promise<PortCategory[]> {
  const categories: PortCategory[] = [];
  for (const port of ports) categories.push(...(await port.preview(client, scope)));
  return categories;
}
export async function denyDerivatives(client: PoolClient, scope: DeletionScope) {
  for (const port of ports) await port.deny(client, scope);
}
export async function purgeDerivatives(client: PoolClient, scope: DeletionScope) {
  for (const port of ports) await port.purge(client, scope);
}

// Absence guard for pinned cross-package tables: a port is inert, never
// erroneous, until its owning module's migration exists on this database.
export async function tableReady(
  client: PoolClient,
  table: string,
  columns: string[],
): Promise<boolean> {
  const found = await client.query<{ reg: string | null }>(
    'SELECT to_regclass($1) AS reg',
    [table],
  );
  if (!found.rows[0].reg) return false;
  const cols = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name=$1",
    [table.split('.')[1]],
  );
  const names = new Set(cols.rows.map(row => row.column_name));
  return columns.every(column => names.has(column));
}

// P5 pin: app.export_request PK(owner,command_key) with state/expiry/manifest
// hash/artifact object id. Deny is intentionally not a blind state write: the
// artifact's lineage invalidation plus the export module's own download
// re-authorization fence use; a module-owned deny port replaces this when P5
// lands. Purge removes rows and has nothing left to erase because the artifact
// lifecycle object (and its bytes) are already deleted by the root purge.
const exportPort: LifecyclePort = {
  name: 'setup-export',
  label: 'Personal data exports',
  async preview(client, scope) {
    if (scope.personal) {
      if (!(await tableReady(client, 'app.export_request', ['owner_id']))) return [];
      const rows = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.export_request WHERE owner_id=$1',
        [scope.ownerId],
      );
      return [{ key: 'exports', label: this.label, count: rows.rows[0].count }];
    }
    if (!scope.rootIds.length) return [];
    if (
      !(await tableReady(client, 'app.export_request', ['artifact_object_id']))
    )
      return [];
    const rows = await client.query<{ count: number }>(
      `WITH RECURSIVE affected AS (
      SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])
      UNION SELECT c.id FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
    ) SELECT count(*)::int AS count FROM app.export_request WHERE artifact_object_id IN (SELECT id FROM affected)`,
      [scope.rootIds],
    );
    return [{ key: 'exports', label: this.label, count: rows.rows[0].count }];
  },
  async deny() {
    // Fenced by lineage invalidation + export re-authorization; see above.
  },
  async purge(client, scope) {
    if (scope.personal) {
      if (!(await tableReady(client, 'app.export_request', ['owner_id']))) return;
      await client.query('DELETE FROM app.export_request WHERE owner_id=$1', [
        scope.ownerId,
      ]);
      return;
    }
    if (
      !scope.objectIds.length ||
      !(await tableReady(client, 'app.export_request', ['artifact_object_id']))
    )
      return;
    await client.query(
      'DELETE FROM app.export_request WHERE artifact_object_id=ANY($1::uuid[])',
      [scope.objectIds],
    );
  },
};

// P4 pin: app.diagnostic_bundle / app.diagnostic_item / app.diagnostic_evidence.
// Submission routes are studies/{id}/check*, so scopedRoot already denies new
// work on deleted roots; the port enumerates and purges the stored evidence.
const diagnosticPort: LifecyclePort = {
  name: 'setup-diagnostic',
  label: 'Setup check evidence',
  async preview(client, scope) {
    if (!scope.rootIds.length) return [];
    if (!(await tableReady(client, 'app.diagnostic_bundle', ['root_id'])))
      return [];
    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app.diagnostic_bundle WHERE root_id=ANY($1::uuid[])',
      [scope.rootIds],
    );
    return [{ key: 'diagnostics', label: this.label, count: rows.rows[0].count }];
  },
  async deny() {
    // studies/{id}/check routes re-authorize the deleted root and fail closed.
  },
  async purge(client, scope) {
    if (!scope.rootIds.length) return;
    if (
      await tableReady(client, 'app.diagnostic_evidence', [
        'bundle_id',
      ])
    )
      await client.query(
        'DELETE FROM app.diagnostic_evidence WHERE bundle_id IN (SELECT id FROM app.diagnostic_bundle WHERE root_id=ANY($1::uuid[]))',
        [scope.rootIds],
      );
    if (await tableReady(client, 'app.diagnostic_item', ['bundle_id']))
      await client.query(
        'DELETE FROM app.diagnostic_item WHERE bundle_id IN (SELECT id FROM app.diagnostic_bundle WHERE root_id=ANY($1::uuid[]))',
        [scope.rootIds],
      );
    if (await tableReady(client, 'app.diagnostic_bundle', ['root_id']))
      await client.query(
        'DELETE FROM app.diagnostic_bundle WHERE root_id=ANY($1::uuid[])',
        [scope.rootIds],
      );
  },
};

// S6: app.ai_draft_request rows are root-scoped derivatives of the exact
// acknowledged selection/extractions the admission pinned. Deny rides the
// existing fences — the worker re-checks lineage before dispatch and
// settleDispatch re-checks before any result is accepted — so no blind state
// write is needed here. app.ai_dispatch_ledger rows are CONTENT-FREE
// owner-scoped accounting (token counts only, untrusted provider claims);
// they are deliberately retention-exempt from ROOT purges (the FK sets
// request_id NULL) so a deletion never makes the owner's budget ledger
// under-count already-dispatched tokens. Whole-personal removal purges them.
const aiSetupPort: LifecyclePort = {
  name: 'ai-setup',
  label: 'AI draft requests',
  async preview(client, scope) {
    if (!scope.rootIds.length) return [];
    if (!(await tableReady(client, 'app.ai_draft_request', ['root_id'])))
      return [];
    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app.ai_draft_request WHERE root_id=ANY($1::uuid[])',
      [scope.rootIds],
    );
    return [{ key: 'ai-drafts', label: this.label, count: rows.rows[0].count }];
  },
  async deny() {
    // Fenced by lineage invalidation + worker/settlement re-checks; see above.
  },
  async purge(client, scope) {
    if (scope.personal) {
      if (await tableReady(client, 'app.ai_dispatch_ledger', ['owner_id']))
        await client.query('DELETE FROM app.ai_dispatch_ledger WHERE owner_id=$1', [
          scope.ownerId,
        ]);
      if (await tableReady(client, 'app.ai_draft_request', ['owner_id']))
        await client.query('DELETE FROM app.ai_draft_request WHERE owner_id=$1', [
          scope.ownerId,
        ]);
      return;
    }
    if (!scope.rootIds.length) return;
    if (await tableReady(client, 'app.ai_draft_request', ['root_id']))
      await client.query(
        'DELETE FROM app.ai_draft_request WHERE root_id=ANY($1::uuid[])',
        [scope.rootIds],
      );
    // Ledger rows survive root purge by design (content-free accounting).
  },
};

registerLifecyclePort(exportPort);
registerLifecyclePort(diagnosticPort);
registerLifecyclePort(aiSetupPort);

// Epic-2 S1: app.generated_course rows (with their cascading course_objective
// and course_source lineage) are root-scoped derivatives of the exact
// confirmed plan revision the generation admission pinned. Deny rides the
// existing fences — the worker re-checks lineage before any dispatch and
// settleDispatch re-checks before any result is accepted — so no blind state
// write is needed here. Purge removes the course lineage with the root; the
// ON DELETE CASCADE from plan/selection revisions keeps root purge correct
// regardless of port ordering inside purgeRoot.
// Epic-2 S2 extends the same port with the supplement tables: the tracked
// supplement passes (app.supplement_request) and their verified rows
// (app.course_supplement) cascade from the course they explain, so deleting
// the course rows removes them in both root and personal scopes, and the
// preview counts them for the deletion preview. The 'supplement' lifecycle
// objects are removed with the root's object deletion like every kind.
// Epic-2 S3 adds the content-item tracker rows (app.course_item_state):
// owner-scoped explicit mark-done state that cascades from its course version,
// so purge rides the course deletion in both scopes and the preview counts
// the rows as their own honest category.
// Epic-2 S5 adds typed practice evidence (app.practice_attempt): one row per
// submission event (attempted text, outcome, learner-declared evidence kind),
// a root derivative cascading from the course lineage exactly like the tracker
// rows — the preview counts it as its own category and purge rides the course
// ON DELETE CASCADE in both scopes.
// Epic-2 S6 adds why explanations (app.why_explanation): one AI-generated
// depth derivative per (owner, course version, lesson, depth), cascading from
// the course lineage the same way (depth unlocks nothing, so the rows carry no
// tracker/credit columns anywhere) — the preview counts them as their own
// category and purge rides the course ON DELETE CASCADE in both scopes.
const courseGenerationPort: LifecyclePort = {
  name: 'course-generation',
  label: 'Generated mini-courses',
  async preview(client, scope) {
    if (scope.personal) {
      if (!(await tableReady(client, 'app.generated_course', ['owner_id']))) return [];
      const rows = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1',
        [scope.ownerId],
      );
      const categories: PortCategory[] = [{ key: 'courses', label: this.label, count: rows.rows[0].count }];
      if (await tableReady(client, 'app.course_supplement', ['course_id'])) {
        const supplements = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id IN (SELECT id FROM app.generated_course WHERE owner_id=$1)',
          [scope.ownerId],
        );
        categories.push({ key: 'supplements', label: 'Verified source supplements', count: supplements.rows[0].count });
      }
      if (await tableReady(client, 'app.course_item_state', ['course_id'])) {
        const tracker = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM app.course_item_state WHERE owner_id=$1',
          [scope.ownerId],
        );
        categories.push({ key: 'tracker-state', label: 'Study tracker state', count: tracker.rows[0].count });
      }
      if (await tableReady(client, 'app.practice_attempt', ['owner_id'])) {
        const practice = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM app.practice_attempt WHERE owner_id=$1',
          [scope.ownerId],
        );
        categories.push({ key: 'practice-evidence', label: 'Practice evidence', count: practice.rows[0].count });
      }
      if (await tableReady(client, 'app.why_explanation', ['owner_id'])) {
        const why = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM app.why_explanation WHERE owner_id=$1',
          [scope.ownerId],
        );
        categories.push({ key: 'why-explanations', label: 'AI why explanations', count: why.rows[0].count });
      }
      return categories;
    }
    if (!scope.rootIds.length) return [];
    if (!(await tableReady(client, 'app.generated_course', ['root_id']))) return [];
    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=ANY($1::uuid[])',
      [scope.rootIds],
    );
    const categories: PortCategory[] = [{ key: 'courses', label: this.label, count: rows.rows[0].count }];
    if (await tableReady(client, 'app.course_supplement', ['course_id'])) {
      const supplements = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id IN (SELECT id FROM app.generated_course WHERE root_id=ANY($1::uuid[]))',
        [scope.rootIds],
      );
      categories.push({ key: 'supplements', label: 'Verified source supplements', count: supplements.rows[0].count });
    }
    if (await tableReady(client, 'app.course_item_state', ['course_id'])) {
      const tracker = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id IN (SELECT id FROM app.generated_course WHERE root_id=ANY($1::uuid[]))',
        [scope.rootIds],
      );
      categories.push({ key: 'tracker-state', label: 'Study tracker state', count: tracker.rows[0].count });
    }
    if (await tableReady(client, 'app.practice_attempt', ['course_id'])) {
      const practice = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.practice_attempt WHERE course_id IN (SELECT id FROM app.generated_course WHERE root_id=ANY($1::uuid[]))',
        [scope.rootIds],
      );
      categories.push({ key: 'practice-evidence', label: 'Practice evidence', count: practice.rows[0].count });
    }
    if (await tableReady(client, 'app.why_explanation', ['course_id'])) {
      const why = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.why_explanation WHERE course_id IN (SELECT id FROM app.generated_course WHERE root_id=ANY($1::uuid[]))',
        [scope.rootIds],
      );
      categories.push({ key: 'why-explanations', label: 'AI why explanations', count: why.rows[0].count });
    }
    return categories;
  },
  async deny() {
    // Fenced by lineage invalidation + worker/settlement re-checks; see above.
  },
  async purge(client, scope) {
    if (scope.personal) {
      if (await tableReady(client, 'app.generated_course', ['owner_id']))
        await client.query('DELETE FROM app.generated_course WHERE owner_id=$1', [scope.ownerId]);
      return;
    }
    if (!scope.rootIds.length) return;
    if (await tableReady(client, 'app.generated_course', ['root_id']))
      await client.query('DELETE FROM app.generated_course WHERE root_id=ANY($1::uuid[])', [scope.rootIds]);
    // supplement_request/course_supplement, course_item_state,
    // practice_attempt and why_explanation ride the course ON DELETE CASCADE.
  },
};

registerLifecyclePort(courseGenerationPort);

// Epic-3 entry 9: scored-assessment derivatives (migrations 021–026) —
// attempts with their at-start snapshots, the targeted-recovery ledger and
// retest chain, monotonic completion awards (mini-course AND parent-path
// rows), the studied-release pointer, the one-way item flag, the dispute
// state machine, its corrected replacements and the content-free daily
// generation counter. Root scope deletes by root_id because the parent-path
// award rows and (transitively) anything else whose course linkage is NULL
// never ride the course ON DELETE CASCADE — the port, not the FK graph, is
// what makes root purge complete. Guidance records are a read-time
// derivation over these rows (no stored copy exists to register). Deny
// rides the existing fences exactly like the course port: every assessment
// verb and read re-runs scopedRoot plus the plan-revision assertObjects
// inside its own AD-2 transaction, the replay path re-runs scopedRoot with
// includeDeleted=false for non-delete actions, and the root-row FOR UPDATE
// serializes an in-flight grade against deletion (a submit either commits
// before the tombstone and is purged with the root, or is denied after) —
// so no blind state write is needed. app.assessment_generation_use is
// CONTENT-FREE owner accounting (the ai_dispatch_ledger precedent): it is
// deliberately not previewed and survives ROOT purge (deleting one study
// must not under-count a budget already consumed); whole-personal removal
// purges it owner-wide.
const assessmentProgressPort: LifecyclePort = {
  name: "assessment-progress",
  label: "Scored assessment evidence",
  async preview(client, scope) {
    const scopeColumn = scope.personal ? "owner_id" : "root_id";
    const scopeArg = scope.personal ? [scope.ownerId] : scope.rootIds;
    if (!scopeArg.length) return [];
    const count = async (table: string, columns: string[]) => {
      if (!(await tableReady(client, `app.${table}`, columns))) return null;
      const rows = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM app.${table} WHERE ${scopeColumn}=ANY($1::uuid[])`,
        [scopeArg],
      );
      return rows.rows[0].count;
    };
    const categories: PortCategory[] = [];
    const attempts = await count("test_attempt", ["root_id"]);
    if (attempts === null) return categories;
    categories.push({ key: "assessment-attempts", label: "Scored test attempts", count: attempts });
    const retests = await count("retest_attempt", ["root_id"]);
    if (retests !== null) categories.push({ key: "assessment-retests", label: "Targeted recovery retests", count: retests });
    const targets = await count("recovery_target", ["root_id"]);
    if (targets !== null) categories.push({ key: "assessment-recovery-ledger", label: "Recovery ledger entries", count: targets });
    const awards = await count("completion_award", ["root_id"]);
    if (awards !== null) categories.push({ key: "assessment-awards", label: "Completion awards and parent paths", count: awards });
    const flags = await count("assessment_flag", ["root_id"]);
    if (flags !== null) categories.push({ key: "assessment-flags", label: "One-way item flags", count: flags });
    const disputes = await count("item_dispute", ["root_id"]);
    if (disputes !== null) categories.push({ key: "assessment-disputes", label: "Item disputes", count: disputes });
    const replacements = await count("assessment_replacement", ["root_id"]);
    if (replacements !== null) categories.push({ key: "assessment-replacements", label: "Corrected replacements", count: replacements });
    const pointers = await count("studied_release", ["root_id"]);
    if (pointers !== null) categories.push({ key: "assessment-release-pointers", label: "Studied-release pointers", count: pointers });
    return categories;
  },
  async deny() {
    // Fenced by scopedRoot + plan-revision assertObjects inside every
    // assessment transaction; see above.
  },
  async purge(client, scope) {
    if (scope.personal) {
      // Owner-wide removal: every assessment row of the owner, generation
      // counter included. Same FK-safe order as the root scope.
      if (await tableReady(client, "app.item_dispute", ["owner_id"]))
        await client.query("DELETE FROM app.item_dispute WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.assessment_replacement", ["owner_id"]))
        await client.query("DELETE FROM app.assessment_replacement WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.retest_attempt", ["owner_id"]))
        await client.query("DELETE FROM app.retest_attempt WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.test_attempt", ["owner_id"]))
        await client.query("DELETE FROM app.test_attempt WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.recovery_target", ["owner_id"]))
        await client.query("DELETE FROM app.recovery_target WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.assessment_flag", ["owner_id"]))
        await client.query("DELETE FROM app.assessment_flag WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.completion_award", ["owner_id"]))
        await client.query("DELETE FROM app.completion_award WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.studied_release", ["owner_id"]))
        await client.query("DELETE FROM app.studied_release WHERE owner_id=$1", [scope.ownerId]);
      if (await tableReady(client, "app.assessment_generation_use", ["owner_id"]))
        await client.query("DELETE FROM app.assessment_generation_use WHERE owner_id=$1", [scope.ownerId]);
      return;
    }
    if (!scope.rootIds.length) return;
    // FK-safe order: disputes before replacements (026's circular
    // resolved_by_replacement FK carries no cascade), attempts before the
    // ledger/flag rows keyed to them; deleting by root_id makes the purge
    // complete regardless of what the course cascade already removed.
    if (await tableReady(client, "app.item_dispute", ["root_id"]))
      await client.query("DELETE FROM app.item_dispute WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.assessment_replacement", ["root_id"]))
      await client.query("DELETE FROM app.assessment_replacement WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.retest_attempt", ["root_id"]))
      await client.query("DELETE FROM app.retest_attempt WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.test_attempt", ["root_id"]))
      await client.query("DELETE FROM app.test_attempt WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.recovery_target", ["root_id"]))
      await client.query("DELETE FROM app.recovery_target WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.assessment_flag", ["root_id"]))
      await client.query("DELETE FROM app.assessment_flag WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.completion_award", ["root_id"]))
      await client.query("DELETE FROM app.completion_award WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    if (await tableReady(client, "app.studied_release", ["root_id"]))
      await client.query("DELETE FROM app.studied_release WHERE root_id=ANY($1::uuid[])", [scope.rootIds]);
    // The content-free generation counter survives root purge by design.
  },
};

registerLifecyclePort(assessmentProgressPort);

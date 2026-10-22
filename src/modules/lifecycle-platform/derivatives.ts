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

registerLifecyclePort(exportPort);
registerLifecyclePort(diagnosticPort);

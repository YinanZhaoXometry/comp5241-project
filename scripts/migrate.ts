import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { PgBoss } from 'pg-boss';
import { createAuth } from '../src/modules/identity-access/auth';
import { EXTRACTION_QUEUE } from '../src/adapters/queue';
import { EXPORT_QUEUE } from '../src/contracts/export';
import { AI_DRAFT_QUEUE } from '../src/contracts/ai-setup';
import { resolve } from 'node:path';

export async function migrate(databaseUrl: string, through?: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    options: '-c search_path=auth,public',
  });
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(5241001)');
    await lock.query(
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS app',
    );
    const migrations = await getMigrations(createAuth(pool).options);
    if (migrations.schemaProblems.length || migrations.unsafeChanges.length)
      throw new Error('Auth migration requires investigation');
    await migrations.runMigrations();
    await lock.query(
      'CREATE TABLE IF NOT EXISTS app.schema_migration(name text PRIMARY KEY, hash text NOT NULL)',
    );
    for (const name of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (through && name > through) continue;
      const sql = await readFile(`migrations/${name}`, 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const prior = await lock.query<{ hash: string }>(
        'SELECT hash FROM app.schema_migration WHERE name=$1',
        [name],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].hash !== hash)
          throw new Error('Applied migration changed');
        continue;
      }
      await lock.query('BEGIN');
      try {
        await lock.query(sql);
        await lock.query('INSERT INTO app.schema_migration VALUES($1,$2)', [
          name,
          hash,
        ]);
        await lock.query('COMMIT');
      } catch (error) {
        await lock.query('ROLLBACK');
        throw error;
      }
    }
    const boss = new PgBoss({
      connectionString: databaseUrl,
      schema: 'queue',
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue(EXTRACTION_QUEUE, {
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 120,
      retentionSeconds: 86400,
    });
    await boss.createQueue(EXPORT_QUEUE);
    await boss.createQueue(AI_DRAFT_QUEUE, { retryLimit: 0, expireInSeconds: 120, retentionSeconds: 86400 });
    await boss.stop();
    await lock.query(
      'GRANT USAGE ON SCHEMA auth,app,queue TO tracer_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth,app,queue TO tracer_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth,app,queue TO tracer_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app,queue TO tracer_runtime',
    );
    await lock.query('REVOKE ALL ON app.schema_migration FROM tracer_runtime');
    console.log(
      'Ordered auth → application → queue migrations complete; runtime role cannot migrate.',
    );
  } finally {
    await lock.query('SELECT pg_advisory_unlock(5241001)');
    lock.release();
    await pool.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve('scripts/migrate.ts')
) {
  const settings = JSON.parse(
    await readFile('.local/migration-config.json', 'utf8'),
  ) as { databaseUrl: string };
  await migrate(settings.databaseUrl);
}

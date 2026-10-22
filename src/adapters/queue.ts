import { PgBoss, type Db } from 'pg-boss';
import type { PoolClient } from 'pg';
import { config } from '../platform/config';
import type { ExtractionJob } from '../contracts/setup';

export const EXTRACTION_QUEUE = 'extract-txt-v1';
let instance: PgBoss | undefined;
export function queue() {
  instance ??= new PgBoss({
    connectionString: config().databaseUrl,
    schema: 'queue',
    migrate: false,
    supervise: false,
    schedule: false,
  });
  return instance;
}
export function transactionDb(client: PoolClient): Db {
  return { executeSql: (text, values) => client.query(text, values) };
}
export function transactionQueue(client: PoolClient) {
  // A dedicated command adapter also routes pg-boss queue-metadata lookups
  // through this client. No hidden pool reads or startup migrations in a command.
  return new PgBoss({
    db: transactionDb(client),
    schema: 'queue',
    migrate: false,
    supervise: false,
    schedule: false,
  });
}
export async function enqueue(client: PoolClient, job: ExtractionJob) {
  return transactionQueue(client).send(EXTRACTION_QUEUE, job, {
    db: transactionDb(client),
    id: job.operationId,
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    expireInSeconds: 120,
    retentionSeconds: 86400,
  });
}
export async function closeQueue() {
  await instance?.stop();
  instance = undefined;
}

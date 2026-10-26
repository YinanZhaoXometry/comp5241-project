import { PgBoss, type Db } from 'pg-boss';
import type { PoolClient } from 'pg';
import { config } from '../platform/config';
import type { ExtractionJob } from '../contracts/setup';
import { AI_DRAFT_QUEUE, type AiDraftJob } from '../contracts/ai-setup';
import { COURSE_QUEUE, type CourseJob } from '../contracts/courses';

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
// S6 AI draft jobs: ONE attempt (retryLimit 0 — the worker itself never
// retries a provider call), bounded by the same 120-second honest pending cap
// the UI shows.
export async function enqueueAiDraft(client: PoolClient, job: AiDraftJob) {
  return transactionQueue(client).send(AI_DRAFT_QUEUE, job, {
    db: transactionDb(client),
    id: job.requestId,
    retryLimit: 0,
    expireInSeconds: 120,
    retentionSeconds: 86400,
  });
}
// Epic-2 S1 course generation jobs: the same single-attempt, 120-second honest
// pending cap the AI draft queue uses — job id = request id.
export async function enqueueCourseGeneration(client: PoolClient, job: CourseJob) {
  return transactionQueue(client).send(COURSE_QUEUE, job, {
    db: transactionDb(client),
    id: job.requestId,
    retryLimit: 0,
    expireInSeconds: 120,
    retentionSeconds: 86400,
  });
}
export async function closeQueue() {
  await instance?.stop();
  instance = undefined;
}

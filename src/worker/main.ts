import { queue, EXTRACTION_QUEUE, closeQueue } from "../adapters/queue";
import { closeDatabase, database } from "../adapters/postgres/database";
import { extractionJobSchema } from "../contracts/setup";
import { runExtraction } from "../modules/materials-setup/extraction";
import { workExports } from "../modules/setup-export/worker";
import { reconcileCopies } from "../modules/lifecycle-platform/service";
import { extractorExists } from "../adapters/private-files";
import { parserReady } from "../adapters/document-extractor";
import { reconcileParsers } from "../adapters/document-sandbox";

const boss = queue();
boss.on("error", () => console.error(JSON.stringify({ event: "queue-error" })));
// Only one worker may reconcile this workspace's containers. A second worker
// must not kill an active first worker's parser or exceed the parser concurrency.
const workerLock = await database().connect();
if (!(await workerLock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(5241002) AS locked")).rows[0].locked) {
  workerLock.release(); await closeDatabase(); throw new Error("Local extraction worker already active");
}
await extractorExists();
await parserReady();
await reconcileParsers();
await reconcileCopies();
await boss.start(); // migrate:false; only the explicit migration command owns DDL.
await boss.work(EXTRACTION_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
  for (const job of jobs) {
    const envelope = extractionJobSchema.parse(job.data);
    if (envelope.operationId !== job.id) throw new Error("Invalid job identity");
    await runExtraction(envelope.operationId);
    console.log(JSON.stringify({ event: "extraction-processed", operationId: envelope.operationId }));
  }
});
await workExports(boss);
let maintaining = false;
const maintenance = setInterval(() => {
  if (maintaining) return;
  maintaining = true;
  void reconcileCopies().then(() => boss.supervise(EXTRACTION_QUEUE))
    .catch(() => console.error(JSON.stringify({ event: "maintenance-retry" })))
    .finally(() => { maintaining = false; });
}, 5000);
console.log(JSON.stringify({ event: "worker-ready" }));
async function shutdown() { clearInterval(maintenance); await closeQueue(); await workerLock.query("SELECT pg_advisory_unlock(5241002)"); workerLock.release(); await closeDatabase(); }
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
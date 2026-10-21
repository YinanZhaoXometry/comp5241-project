import { queue, EXTRACTION_QUEUE, closeQueue } from "../adapters/queue";
import { closeDatabase } from "../adapters/postgres/database";
import { extractionJobSchema } from "../contracts/setup";
import { runExtraction } from "../modules/materials-setup/extraction";
import { reconcileCopies } from "../modules/lifecycle-platform/service";
import { extractorExists } from "../adapters/private-files";

const boss = queue();
boss.on("error", () => console.error(JSON.stringify({ event: "queue-error" })));
await extractorExists();
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
let maintaining = false;
const maintenance = setInterval(() => {
  if (maintaining) return;
  maintaining = true;
  void reconcileCopies().then(() => boss.supervise(EXTRACTION_QUEUE))
    .catch(() => console.error(JSON.stringify({ event: "maintenance-retry" })))
    .finally(() => { maintaining = false; });
}, 5000);
console.log(JSON.stringify({ event: "worker-ready" }));
async function shutdown() { clearInterval(maintenance); await closeQueue(); await closeDatabase(); }
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
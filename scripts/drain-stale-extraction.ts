import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

// Gate-hygiene step (2026-10-29): the integration suite resolves operations
// IN-PROCESS (runExtraction/runCourseGeneration/runExport/… directly), but
// each request ALSO enqueues a queue copy that nothing consumes until the
// e2e step launches a worker. Hundreds of those dead duplicates accumulate
// across EVERY application queue per integration run, and the worker must
// early-return over the whole backlog before it reaches the first live
// browser journeys — the documented first-file e2e stalls (attempt.spec
// waiting on previews, then on course generation, that pass solo in
// seconds). This step runs between the gate's integration and e2e phases
// and cancels CREATED jobs on the application queues only: at that point no
// live job exists (the browser suite has not started), and every created
// job is by construction a duplicate whose operation row a suite already
// resolved — the worker's own handler would early-return on it. No check,
// assertion or test behavior changes; this removes only dead queue entries,
// the same class of hygiene as killing leftover dev servers.
const queues = ["extract-txt-v1", "course-generation", "supplement-fetch-v1", "why-step-v1", "ai-draft", "export-setup-v1"];
const settings = JSON.parse(await readFile(resolve(".local/migration-config.json"), "utf8")) as { databaseUrl: string };
const pool = new Pool({ connectionString: settings.databaseUrl, options: "-c search_path=auth,public" });
try {
  for (const queue of queues) {
    const result = await pool.query(
      "UPDATE queue.job SET state='cancelled' WHERE name=$1 AND state='created' RETURNING id",
      [queue],
    );
    console.log(`Cancelled ${result.rowCount} stale duplicate ${queue} queue jobs (operations already resolved in-process; e2e not yet running).`);
  }
} finally {
  await pool.end();
}

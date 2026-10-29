import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

// Gate-hygiene step (2026-10-29): the integration suite processes every
// extraction operation IN-PROCESS (runExtraction directly), but each upload
// slot ALSO enqueues an extract-txt-v1 queue copy that nothing consumes
// until the e2e step launches a worker. Hundreds of those dead duplicates
// accumulate per integration run, and the worker must early-return over the
// whole backlog before it reaches the first live browser journeys — the
// documented first-file e2e timeouts (attempt.spec waiting minutes for
// previews that pass solo in seconds). This step runs between the gate's
// build and e2e phases and cancels CREATED extract jobs only: at that point
// no live extraction exists (the browser suite has not started), and every
// created extract job is by construction a duplicate whose operation row a
// suite already resolved — the worker's own handler would early-return on
// it. No check, assertion or test behavior changes; this removes only dead
// queue entries, the same class of hygiene as killing leftover dev servers.
const settings = JSON.parse(await readFile(resolve(".local/migration-config.json"), "utf8")) as { databaseUrl: string };
const pool = new Pool({ connectionString: settings.databaseUrl, options: "-c search_path=auth,public" });
try {
  const result = await pool.query(
    "UPDATE queue.job SET state='cancelled' WHERE name='extract-txt-v1' AND state='created' RETURNING id",
  );
  console.log(`Cancelled ${result.rowCount} stale duplicate extract-txt-v1 queue jobs (operations already resolved in-process; e2e not yet running).`);
} finally {
  await pool.end();
}

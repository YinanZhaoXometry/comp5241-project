import { expect, it } from "vitest";
import { Pool, Client } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PgBoss } from "pg-boss";
import { migrate } from "../../scripts/migrate";
import { createAuth } from "../../src/modules/identity-access/auth";
import { objectsActive } from "../../src/modules/lifecycle-platform/repository";

it("additively migrates legacy confirmed singleton identities and queued v1 jobs without duplicate copies", async () => {
  const admin = new Client({ host: resolve(".local/pg-socket"), port: 55432, user: "tracer_bootstrap", database: "postgres" });
  const name = `compat_${crypto.randomUUID().replaceAll("-", "")}`;
  const settings = JSON.parse(await readFile(".local/migration-config.json", "utf8")) as { databaseUrl: string };
  const url = new URL(settings.databaseUrl); url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.href, options: "-c search_path=auth,public" });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} OWNER tracer_owner`);
    await migrate(url.href, "001-tracer.sql");
    const signup = await createAuth(pool, true).api.signUpEmail({ body: { name: "Synthetic compatibility", email: `${crypto.randomUUID()}@synthetic.invalid`, password: randomBytes(32).toString("base64url") } });
    const owner = signup.user.id; const root = crypto.randomUUID(); const original = crypto.randomUUID(); const extracted = crypto.randomUUID(); const plan = crypto.randomUUID(); const jobId = crypto.randomUUID();
    await pool.query("INSERT INTO app.identity_principal(user_id,role) VALUES($1,'learner')", [owner]);
    await pool.query("INSERT INTO app.lifecycle_root(id,owner_id) VALUES($1,$2)", [root, owner]);
    for (const [id, kind, parents] of [[original, "original", []], [extracted, "extraction", [original]], [plan, "plan", [extracted]]] as const) await pool.query("INSERT INTO app.lifecycle_object(id,root_id,kind,parent_ids,storage_key) VALUES($1,$2,$3,$4,$5)", [id, root, kind, parents, kind === "plan" ? null : crypto.randomUUID()]);
    await pool.query("INSERT INTO app.material(id,filename,original_id,byte_length,revision) VALUES($1,'legacy.txt',$2,16,3)", [root, original]);
    await pool.query("INSERT INTO app.extraction_revision(id,root_id,text_hash) VALUES($1,$2,'synthetic-hash')", [extracted, root]);
    const content = { topic: "Exact legacy Manual plan", immutable: true };
    await pool.query("INSERT INTO app.plan_revision(id,root_id,extraction_id,plan) VALUES($1,$2,$3,$4)", [plan, root, extracted, content]);
    await pool.query("INSERT INTO app.plan_confirmation(plan_id,root_id) VALUES($1,$2)", [plan, root]);
    await pool.query("UPDATE app.material SET extraction_id=$2,draft_id=$3,confirmed_id=$3 WHERE id=$1", [root, extracted, plan]);
    const envelope = { schemaVersion: 1, operationId: jobId, rootId: root, ownerId: owner, sessionId: crypto.randomUUID(), generation: 0, epoch: 0 };
    const boss = new PgBoss({ connectionString: url.href, schema: "queue", migrate: false, supervise: false, schedule: false });
    await boss.start();
    await boss.send("extract-txt-v1", envelope, { id: jobId }); await boss.stop();
    const before = (await pool.query("SELECT id,storage_key FROM app.lifecycle_object WHERE storage_key IS NOT NULL ORDER BY id")).rows;
    await migrate(url.href); await migrate(url.href);
    expect((await pool.query("SELECT id,storage_key FROM app.lifecycle_object WHERE storage_key IS NOT NULL ORDER BY id")).rows).toEqual(before);
    const migrated = (await pool.query("SELECT * FROM app.study_batch WHERE id=$1", [root])).rows[0];
    expect(migrated).toMatchObject({ confirmed_id: plan, draft_id: plan, revision: 3, legacy: true });
    expect((await pool.query("SELECT plan,extraction_id,selection_id FROM app.plan_revision WHERE id=$1", [plan])).rows[0]).toMatchObject({ plan: content, extraction_id: extracted, selection_id: migrated.selection_id });
    expect((await pool.query("SELECT data FROM queue.job WHERE id=$1", [jobId])).rows[0].data).toEqual(envelope);
    const client = await pool.connect(); try { expect(await objectsActive(client, owner, [plan, plan])).toBe(true); } finally { client.release(); }
    await expect(pool.query("UPDATE app.selection_revision SET excluded='[]' WHERE id=$1", [migrated.selection_id])).rejects.toThrow("Immutable revision");
    // The double migrate() above also proves 018's idempotency. On this FRESH
    // database the canonical disclosure versions all insert (the long-lived dev
    // database can carry sibling suites' synthetic spy fixtures on small
    // version numbers, which the ON CONFLICT (version) DO NOTHING guards then
    // skip — the standing drift the integration suites' grant() helpers
    // tolerate); pin migration 018's v7 row here where no spy can squat it:
    // cumulative purpose naming the stated background, honest local-fixture
    // retention notice, eligible.
    const v7 = (await pool.query("SELECT id,version,purpose,categories,retention_notice,eligibility FROM app.processor_configuration WHERE version=7")).rows[0];
    expect(v7).toMatchObject({ id: "52410003-0000-4000-8000-000000000007", version: 7, eligibility: "eligible" });
    expect(v7.categories).toContain("stated background");
    expect(v7.categories).toContain("selected source excerpts"); // cumulative: nothing dropped from v6
    expect(v7.purpose).toContain("pitched to the stated background");
    expect(v7.purpose).toContain("supplement proposals"); // cumulative over the v6 purpose
    expect(v7.retention_notice).toContain("identical for every track");
  } finally { await pool.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); }
}, 60000);
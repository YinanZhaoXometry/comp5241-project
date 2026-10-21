import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const directory = resolve(".local/pg18");
const socket = resolve(".local/pg-socket");
const bin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@18/bin";
const action = process.argv[2] ?? "start";
if (!["start", "stop", "status"].includes(action)) throw new Error("Use start, stop or status");
await mkdir(resolve(".local"), { recursive: true, mode: 0o700 });
await mkdir(socket, { recursive: true, mode: 0o700 });
if (action !== "start") {
  execFileSync(`${bin}/pg_ctl`, ["-D", directory, action, ...(action === "stop" ? ["-m", "fast"] : [])], { stdio: "inherit" });
} else {
  let exists = true;
  try { await stat(`${directory}/PG_VERSION`); } catch { exists = false; }
  if (!exists) execFileSync(`${bin}/initdb`, ["-D", directory, "--auth-local=trust", "--auth-host=scram-sha-256", "--no-instructions", "--username=tracer_bootstrap"], { stdio: "inherit" });
  const running = (() => { try { execFileSync(`${bin}/pg_ctl`, ["-D", directory, "status"], { stdio: "ignore" }); return true; } catch { return false; } })();
  if (!running) execFileSync(`${bin}/pg_ctl`, ["-D", directory, "-l", resolve(".local/postgres.log"), "-o", `-h 127.0.0.1 -p 55432 -k '${socket}'`, "-w", "start"], { stdio: "inherit" });
  let configured = true;
  try { await readFile(".local/runtime-config.json"); } catch { configured = false; }
  if (!configured) {
    const admin = new pg.Client({ host: socket, port: 55432, user: "tracer_bootstrap", database: "postgres" });
    await admin.connect();
    try {
      const ownerPassword = randomBytes(32).toString("hex");
      const runtimePassword = randomBytes(32).toString("hex");
      await admin.query(`CREATE ROLE tracer_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(ownerPassword)}`);
      await admin.query(`CREATE ROLE tracer_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(runtimePassword)}`);
      await admin.query("CREATE DATABASE tracer_synthetic OWNER tracer_owner");
      await writeFile(".local/migration-config.json", JSON.stringify({ databaseUrl: `postgresql://tracer_owner:${ownerPassword}@127.0.0.1:55432/tracer_synthetic` }), { mode: 0o600, flag: "wx" });
      await writeFile(".local/runtime-config.json", JSON.stringify({ databaseUrl: `postgresql://tracer_runtime:${runtimePassword}@127.0.0.1:55432/tracer_synthetic`, authSecret: randomBytes(48).toString("base64url"), origin: "http://127.0.0.1:3000" }), { mode: 0o600, flag: "wx" });
    } finally { await admin.end(); }
  }
  console.log("Isolated synthetic PostgreSQL ready on loopback:55432; private configuration written without printing credentials.");
}
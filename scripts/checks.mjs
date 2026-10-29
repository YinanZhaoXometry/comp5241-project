import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.version !== "v24.22.0" || process.platform !== "darwin") throw new Error("Use the verified local macOS Node24 runtime; no alternate sandbox is assumed safe.");
const npm = process.env.npm_execpath ?? resolve(process.execPath, "../lib/node_modules/npm/bin/npm-cli.js");
const env = { ...process.env, NPM_CONFIG_USERCONFIG: "/dev/null", NEXT_TELEMETRY_DISABLED: "1", PLAYWRIGHT_BROWSERS_PATH: resolve(".local/playwright") };
const commands = [["run", "audit"], ["run", "lint"], ["run", "boundaries"], ["run", "typecheck"], ["run", "typecheck:worker"], ["run", "test"], ["run", "extractor:build"], ["run", "db:start"], ["run", "migrate"], ["run", "test:integration"], ["run", "queue:drain"], ["run", "build"], ["run", "test:e2e"], ["run", "test:restart"]];
for (const args of commands) {
  const result = spawnSync(process.execPath, [npm, ...args], { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("All local synthetic quality gates passed. This is not deployment/provider/retention approval.");
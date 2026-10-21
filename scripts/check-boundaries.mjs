import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(path); continue; }
    if (!/\.[cm]?[jt]sx?$/u.test(path)) continue;
    const source = await readFile(path, "utf8");
    const file = relative("src", path);
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)) {
      const target = match[1];
      if (file.startsWith("contracts/")) assert.ok(!/adapters|modules|platform|next|^pg$/u.test(target), `Domain contract dependency: ${file}`);
      if (file.startsWith("modules/")) assert.ok(!/\/app\/|\/worker\/|^next(?:\/|$)/u.test(target), `Application dependency direction: ${file}`);
      if (file.startsWith("worker/")) assert.ok(!/\/app\/|^next(?:\/|$)/u.test(target), `Worker must share services, not web: ${file}`);
      if (file.startsWith("app/")) assert.ok(!/adapters\/postgres|^pg$/u.test(target), `HTTP/UI must use scoped services: ${file}`);
    }
  }
}
await inspect("src");
console.log("Module dependency-direction checks passed.");
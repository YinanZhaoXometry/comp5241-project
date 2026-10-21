import { mkdir, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("TXT isolation is verified on macOS only; fail closed on other platforms");
await mkdir(".local/bin", { recursive: true, mode: 0o700 });
execFileSync("/usr/bin/clang", ["-O2", "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations", "src/worker/txt-extract.c", "-o", ".local/bin/txt-extract"], { stdio: "inherit" });
await chmod(".local/bin/txt-extract", 0o700);
execFileSync(resolve(".local/bin/txt-extract"), ["--probe"], { env: { NODE_ENV: "production" }, timeout: 10000, stdio: "pipe" });
console.log("TXT helper built; OS network/read/write denial probe passed. CPU 2s, fixed buffer 20MiB+1, RSS guard 128MiB (not a kernel memory cap), wall 10s, input/output 20MiB.");
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_BYTES } from "../contracts/setup";
import { MAX_METADATA } from "../contracts/documents";

export const parserLabel = `comp5241.parser=${createHash("sha256").update(resolve(".")).digest("hex").slice(0, 16)}`;
export const daemonHost = `unix://${process.env.HOME}/.colima/default/docker.sock`;
export const dockerEnv: NodeJS.ProcessEnv = { PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: process.env.HOME!, NODE_ENV: "production" };
export type ParserError = Error & { reason: "resource" | "service"; observation?: { oomKilled: boolean; exitCode: number } };
export function parserFailure(reason: "resource" | "service"): ParserError { return Object.assign(new Error(`Document extraction ${reason} failure`), { reason }); }
export function isParserFailure(error: unknown): error is ParserError { return error instanceof Error && "reason" in error && (error.reason === "resource" || error.reason === "service"); }
export function docker(args: string[], maxBuffer = 1024 * 1024): Promise<Buffer> {
  return new Promise((accept, reject) => execFile("/opt/homebrew/bin/docker", ["--host", daemonHost, ...args], { env: dockerEnv, timeout: 15000, maxBuffer, encoding: "buffer" }, (error, stdout) => error ? reject(parserFailure("service")) : accept(stdout)));
}
export async function parserFingerprint() {
  const hash = createHash("sha256");
  for (const file of ["src/worker/parser/Dockerfile", "src/worker/parser/requirements.txt", "src/worker/parser/disable_xmp.py", "src/worker/parser/parser.py", "src/worker/parser/seccomp.json", "src/adapters/document-sandbox.ts", "src/adapters/document-extractor.ts", "scripts/build-extractor.ts"]) hash.update(await readFile(file));
  return hash.digest("hex");
}
export type Admission = { image: string; daemon: string; engine: string; fingerprint: string; auditHash: string; verifiedAt: string };
export async function admittedParser(): Promise<Admission> {
  try {
    const file = resolve(".local/parser-admission.json");
    if ((await stat(file)).mode & 0o077) throw parserFailure("service");
    const pin = JSON.parse(await readFile(file, "utf8")) as Admission;
    if (!/^sha256:[0-9a-f]{64}$/u.test(pin.image) || pin.fingerprint !== await parserFingerprint()) throw parserFailure("service");
    if (pin.auditHash !== createHash("sha256").update(await readFile(".local/parser-audit.json")).digest("hex")) throw parserFailure("service");
    const current = JSON.parse((await docker(["info", "--format", "{{json .}}"])) .toString()) as { ID: string; ServerVersion: string; OSType: string; Architecture: string; SecurityOptions: string[]; MemoryLimit: boolean; SwapLimit: boolean; PidsLimit: boolean };
    if (current.ID !== pin.daemon || current.ServerVersion !== pin.engine || current.OSType !== "linux" || current.Architecture !== "aarch64" || !current.MemoryLimit || !current.SwapLimit || !current.PidsLimit || !current.SecurityOptions.some(s => s.startsWith("name=seccomp"))) throw parserFailure("service");
    return pin;
  } catch { throw parserFailure("service"); }
}
export type SandboxObservation = { networkMode: string; mountCount: number; readonly: boolean; memoryLimit: number; memorySwap: number; elapsedMs: number; oomKilled: boolean; exitCode: number; changedPaths: string[]; removed: boolean };
export async function sandbox(image: string, args: string[], input: Buffer = Buffer.alloc(0), wallMs = 30000, observe?: (value: SandboxObservation) => Promise<void>) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(image)) throw parserFailure("service");
  const name = `comp5241-parser-${crypto.randomUUID()}`;
  const started = Date.now();
  let observation: SandboxObservation | undefined;
  let output: Buffer;
  let created = false;
  try {
    await docker(["create", "--name", name, "--label", parserLabel, "--pull", "never", "--interactive", "--log-driver", "none", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--security-opt", `seccomp=${resolve("src/worker/parser/seccomp.json")}`, "--memory", "536870912", "--memory-swap", "536870912", "--cpus", "1", "--pids-limit", "16", "--ulimit", "nofile=64:64", "--ulimit", "cpu=10:10", "--ulimit", "core=0:0", "--ipc", "none", "--user", "65532:65532", image, ...args]);
    created = true;
    const inspection = JSON.parse((await docker(["inspect", name])).toString())[0];
    const host = inspection.HostConfig;
    if (inspection.Image !== image || inspection.Mounts.length || host.NetworkMode !== "none" || !host.ReadonlyRootfs || host.Privileged || host.Memory !== 536870912 || host.MemorySwap !== 536870912 || host.NanoCpus !== 1000000000 || host.PidsLimit !== 16 || host.LogConfig.Type !== "none" || inspection.Config.User !== "65532:65532" || inspection.Config.Labels[parserLabel.split("=")[0]] !== parserLabel.split("=")[1]) throw parserFailure("service");
    if (host.CapDrop?.length !== 1 || host.CapDrop[0] !== "ALL" || host.CapAdd?.length || host.Binds?.length || host.Devices?.length || host.PublishAllPorts || Object.keys(host.PortBindings ?? {}).length || !host.SecurityOpt.includes("no-new-privileges=true") || !host.SecurityOpt.some((option: string) => option.startsWith("seccomp="))) throw parserFailure("service");
    for (const [limit, ceiling] of [["nofile", 64], ["cpu", 10], ["core", 0]] as const) if (!host.Ulimits.some((value: { Name: string; Soft: number; Hard: number }) => value.Name === limit && value.Soft === ceiling && value.Hard === ceiling)) throw parserFailure("service");
    let resource = false;
    output = await new Promise<Buffer>((accept, reject) => {
      const child = execFile("/opt/homebrew/bin/docker", ["--host", daemonHost, "start", "--attach", "--interactive", name], { env: dockerEnv, maxBuffer: MAX_BYTES + MAX_METADATA + 4, encoding: "buffer" }, (error, stdout) => {
        clearTimeout(timer);
        if (error) reject(parserFailure(resource || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || error.code === 137 ? "resource" : "service")); else accept(stdout);
      });
      const timer = setTimeout(() => { resource = true; void docker(["kill", name]).catch(() => undefined); child.kill("SIGKILL"); }, wallMs);
      child.stdin!.on("error", () => { /* Early parser exit is accounted by the exit status. */ });
      child.stdin!.end(input);
    });
    if (observe) {
      const state = JSON.parse((await docker(["inspect", name, "--format", "{{json .State}}"])).toString());
      const changedPaths = (await docker(["diff", name])).toString().trim().split("\n").filter(Boolean);
      observation = { networkMode: host.NetworkMode, mountCount: inspection.Mounts.length, readonly: host.ReadonlyRootfs, memoryLimit: host.Memory, memorySwap: host.MemorySwap, elapsedMs: Date.now() - started, oomKilled: state.OOMKilled, exitCode: state.ExitCode, changedPaths, removed: false };
    }
  } catch (error) {
    if (created && isParserFailure(error)) {
      const state = JSON.parse((await docker(["inspect", name, "--format", "{{json .State}}"])).toString());
      error.observation = { oomKilled: state.OOMKilled, exitCode: state.ExitCode };
    }
    throw error;
  } finally {
    // A failed cleanup is a service failure, never a usable result.
    if (created) await docker(["rm", "--force", name]);
  }
  if (observation && observe) {
    const remaining = (await docker(["ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])).toString().trim();
    if (remaining) throw parserFailure("service");
    await observe({ ...observation, removed: true });
  }
  return output;
}
export async function reconcileParsers() {
  const names = (await docker(["ps", "--all", "--filter", `label=${parserLabel}`, "--format", "{{.Names}}"])).toString().trim().split("\n").filter(Boolean);
  // Called before worker readiness, not while another admitted worker is running.
  for (const name of names) {
    if (!/^comp5241-parser-[0-9a-f-]{36}$/u.test(name)) throw parserFailure("service");
    await docker(["rm", "--force", name]);
  }
}
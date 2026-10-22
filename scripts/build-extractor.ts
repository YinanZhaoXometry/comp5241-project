import { mkdir, chmod, readFile, writeFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { docker, dockerEnv, daemonHost, sandbox, parserFingerprint, reconcileParsers, parserLabel, isParserFailure, type ParserError, type SandboxObservation } from "../src/adapters/document-sandbox";
import { decodeExtraction } from "../src/adapters/document-extractor";
import { docx, pdf, atLimitDocx } from "../tests/fixtures/documents";
import { MAX_BYTES } from "../src/contracts/setup";

if (process.platform !== "darwin") throw new Error("TXT isolation is verified on macOS only; fail closed on other platforms");
await mkdir(".local/bin", { recursive: true, mode: 0o700 });
execFileSync("/usr/bin/clang", ["-O2", "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations", "src/worker/txt-extract.c", "-o", ".local/bin/txt-extract"], { stdio: "inherit" });
await chmod(".local/bin/txt-extract", 0o700);
execFileSync(resolve(".local/bin/txt-extract"), ["--probe"], { env: { NODE_ENV: "production" }, timeout: 10000, stdio: "pipe" });
console.log("TXT helper built; OS network/read/write denial probe passed. CPU 2s, fixed buffer 20MiB+1, RSS guard 128MiB (not a kernel memory cap), wall 10s, input/output 20MiB.");

// Only this explicit build command may pull/build/audit. Runtime uses --pull never.
await unlink(".local/parser-admission.json").catch(error => { if (error.code !== "ENOENT") throw error; });
execFileSync("/opt/homebrew/bin/docker", ["--host", daemonHost, "build", "--platform", "linux/arm64", "--tag", "comp5241-bounded-parser:local", "src/worker/parser"], { env: dockerEnv, stdio: "inherit" });
const image = (await docker(["image", "inspect", "comp5241-bounded-parser:local", "--format", "{{.Id}}"])).toString().trim();
execFileSync("/opt/homebrew/bin/trivy", ["image", "--scanners", "vuln", "--image-src", "docker", "--ignorefile", "/dev/null", "--exit-code", "1", "--format", "json", "--output", resolve(".local/parser-audit.json"), image], { env: { ...dockerEnv, DOCKER_HOST: daemonHost }, stdio: "inherit" });
const info = JSON.parse((await docker(["info", "--format", "{{json .}}"])) .toString());
await reconcileParsers();
const isolation = JSON.parse((await sandbox(image, ["--probe", "isolation"])).toString());
assert.ok(Object.values(isolation).every(value => value === true));
const versions = JSON.parse((await sandbox(image, ["--probe", "versions"])).toString());
assert.equal(versions.python, "3.14.8"); assert.equal(versions.pypdf, "6.21.1");
// Binary-wheel native libraries are not reliably inventoried by image scanners.
// Check the source-built runtime and compiled versions, and absence of Expat.
assert.equal(versions.lxml, "6.1.3");
assert.equal(versions.libxml, "2.15.4"); assert.equal(versions.libxmlCompiled, "2.15.4");
assert.equal(versions.libxslt, "1.1.45"); assert.equal(versions.libxsltCompiled, "1.1.45");
assert.equal(versions.expatImportable, false); assert.equal(versions.expatLoaded, false);
assert.deepEqual(versions.unavailable, ["pyexpat", "_elementtree", "xml.parsers.expat", "xml.dom.expatbuilder"]);
assert.equal(versions.xmpPolicy, "disabled-v1");
const xmp = JSON.parse((await sandbox(image, ["--probe", "xmp-policy"])).toString());
assert.deepEqual(xmp, { dataRead: false, constructorBlocked: true, createBlocked: true, dictionaryBlocked: true, writerBlocked: true, readerBlocked: true, expatImportable: false, expatLoaded: false });
assert.ok(["catalog", "http", "ftp", "zlib", "iconv", "icu", "lzma"].every(feature => !versions.features.includes(feature)));
const measurements: { probe: string; milliseconds: number; outcome: string; observation: ParserError["observation"] }[] = [];
for (const probe of ["memory", "cpu", "wall", "output"]) {
	const start = Date.now();
	let failure: ParserError | undefined;
	try { await sandbox(image, ["--probe", probe]); } catch (error) { if (isParserFailure(error)) failure = error; else throw error; }
	assert.ok(failure);
	const elapsed = Date.now() - start;
	assert.ok(elapsed < 45000, "Container outlived the bounded supervisor");
	if (probe === "memory") assert.equal(failure.observation?.oomKilled, true);
	if (probe === "cpu") assert.ok(elapsed >= 9000 && elapsed < 20000);
	if (probe === "wall") assert.ok(elapsed >= 29000);
	measurements.push({ probe, milliseconds: elapsed, outcome: "killed-and-removed", observation: failure.observation });
}
for (const [format, bytes] of [["txt", Buffer.alloc(MAX_BYTES, 65)], ["md", Buffer.concat([Buffer.from("# Sample\n"), Buffer.alloc(MAX_BYTES - 9, 10)])], ["pdf", pdf(true)], ["docx", atLimitDocx()]] as const) {
	assert.equal(bytes.length, MAX_BYTES);
	const result = decodeExtraction(await sandbox(image, [format], bytes));
	assert.equal(result.metadata.format, format);
	if (format === "txt" || format === "md") assert.ok(Buffer.from(result.text).equals(bytes));
}
const hostileObservations: { fixture: string; observation: SandboxObservation }[] = [];
for (const [label, input] of [["traversal", docx([{ name: "../../escape", content: "synthetic" }])], ["expansion", docx([{ name: "word/bomb", content: Buffer.alloc(33 * 1024 * 1024, 65), compressed: true }])], ["external", docx([{ name: "word/_rels/document.xml.rels", content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="hyperlink" TargetMode="External" Target="http://127.0.0.1:9/private"/></Relationships>' }])], ["private-read", docx([], '<!DOCTYPE w [<!ENTITY x SYSTEM "file:///host/.local/runtime-config.json">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">&x;</w:document>')]] as const) {
	const output = await sandbox(image, ["docx"], input, 30000, async observation => {
		assert.equal(observation.networkMode, "none"); assert.equal(observation.mountCount, 0); assert.equal(observation.readonly, true);
		assert.equal(observation.memoryLimit, 536870912); assert.equal(observation.memorySwap, 536870912);
		assert.deepEqual(observation.changedPaths, []); assert.equal(observation.removed, true); assert.ok(observation.elapsedMs < 45000);
		hostileObservations.push({ fixture: label, observation });
	});
	assert.throws(() => decodeExtraction(output), label);
}
assert.equal((await docker(["ps", "--all", "--filter", `label=${parserLabel}`, "--format", "{{.ID}}"])).toString().trim(), "");
const evidence = { image, daemon: info.ID, engine: info.ServerVersion, fingerprint: await parserFingerprint(), auditHash: createHash("sha256").update(await readFile(".local/parser-audit.json")).digest("hex"), verifiedAt: new Date().toISOString(), versions, isolation, measurements, hostileObservations };
await writeFile(".local/parser-admission.json", JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log("Four-format sandbox admitted after full image audit, real boundary fixtures, denial/resource probes and empty container inventory.");
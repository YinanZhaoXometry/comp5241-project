import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

async function inspect(directory, sources) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(path, sources); continue; }
    if (!/\.[cm]?[jt]sx?$/u.test(path)) continue;
    const source = await readFile(path, "utf8");
    const file = relative("src", path);
    sources.set(file, source);
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)) {
      const target = match[1];
      if (file.startsWith("contracts/")) assert.ok(!/adapters|modules|platform|next|^pg$/u.test(target), `Domain contract dependency: ${file}`);
      if (file.startsWith("modules/")) assert.ok(!/\/app\/|\/worker\/|^next(?:\/|$)/u.test(target), `Application dependency direction: ${file}`);
      if (file.startsWith("worker/")) assert.ok(!/\/app\/|^next(?:\/|$)/u.test(target), `Worker must share services, not web: ${file}`);
      if (file.startsWith("app/")) assert.ok(!/adapters\/postgres|^pg$/u.test(target), `HTTP/UI must use scoped services: ${file}`);
    }
  }
}

/** Follow client imports/re-exports transitively; keep the SDK and keyed adapter server-side. */
export function assertProviderIsolation(sources) {
  const graph = new Map();
  const clients = [];
  for (const [file, source] of sources) {
    const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = new Set();
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) imports.add(node.moduleReference.expression.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) imports.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(syntax);
    if (syntax.statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client")) clients.push(file);
    if (file.startsWith("contracts/")) for (const target of imports) assert.ok(!/^openai(?:\/|$)/u.test(target), `Domain contract provider dependency: ${file}`);
    graph.set(file, imports);
  }
  for (const client of clients) {
    const pending = [client];
    const visited = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      assert.notEqual(file, "adapters/openai-compatible.ts", `Client provider dependency: ${client}`);
      for (const target of graph.get(file) ?? []) {
        assert.ok(!/^openai(?:\/|$)/u.test(target), `Client provider dependency: ${client}`);
        const local = target.startsWith("@/") ? normalize(target.slice(2)) : target.startsWith(".") ? normalize(join(dirname(file), target)) : undefined;
        if (!local) continue;
        const stem = local.replace(/\.[cm]?jsx?$/u, "");
        const resolved = [local, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.js`, `${local}/index.ts`, `${local}/index.tsx`].find(candidate => sources.has(candidate));
        if (resolved) pending.push(resolved);
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sources = new Map();
  await inspect("src", sources);
  assertProviderIsolation(sources);
  console.log("Module dependency-direction and transitive client/provider isolation checks passed.");
}
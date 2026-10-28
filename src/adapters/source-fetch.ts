import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { z } from "zod";

// AD-11 bounded public-source fetch adapter (epic-2 S2). This is the fetch
// boundary the architecture demands and it is COMPLETE but DORMANT: the only
// wiring in this build runs it over deterministic local FIXTURES with zero
// network egress (see src/modules/course-generation/supplements.ts). Live
// activation requires an admitted operator-owned .local/source-fetch.json —
// absent here — whose admission prerequisites gate F-B owns
// (docs/bounded-source-fetch.md). Without that file nothing in this adapter
// ever opens a socket: loadSourceFetchConfig returns null and a live fetch
// reports the honest `fetch-unavailable`.
//
// Validation is deliberately layered so untrusted inputs can never reach a
// connection: URL shape (HTTPS-only, allowlisted host, no credentials, no
// non-standard port, printable ASCII, bounded length) is checked before any
// resolution; DNS answers are validated against the denied-address ranges and
// the CONNECTED address is the validated one (the production transport's
// custom lookup ignores DNS entirely at connect time, so rebinding between
// check and connect cannot happen); every redirect hop re-runs the whole
// scheme+allowlist+DNS/IP validation; and bodies are bounded by both a
// Content-Length pre-check and a streamed byte cap.

export type FetchDenyReason = "scheme" | "credential" | "host" | "port" | "length" | "ip" | "redirect" | "size" | "query";
export type BoundedFetchFailureCode = "denied" | "timeout" | "transport" | "status" | "unavailable";
export type BoundedFetchFailure = { ok: false; code: BoundedFetchFailureCode; reason?: FetchDenyReason; message: string };
export type BoundedFetchSuccess = {
  ok: true;
  // The FINAL URL after every validated redirect hop.
  url: string;
  origin: string;
  status: number;
  text: string;
  contentHash: string;
  retrievedAt: string;
  hops: string[];
};
export type BoundedFetchResult = BoundedFetchSuccess | BoundedFetchFailure;
export type BoundedFetchPort = { fetch(target: string): Promise<BoundedFetchResult> };

// Transport and resolver are injectable so every validation path is testable
// with zero network (the openai-compatible adapter's transport-injection
// pattern). Production implementations are the stdlib-only defaults below.
export type TransportResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array> };
export type FetchTransport = (url: URL, validatedAddress: string, signal: AbortSignal) => Promise<TransportResponse>;
export type AddressResolver = (host: string) => Promise<string>;

const URL_LIMIT = 2048;

// URL-shape validation, pure and total. Denials happen here — before any DNS
// resolution or connection attempt. Allowlist entries are exact hostnames
// (lowercased); a suffix match would silently widen the egress surface.
export function validateFetchUrl(
  raw: string,
  allowlist: readonly string[],
): { ok: true; url: URL } | { ok: false; reason: "scheme" | "credential" | "host" | "port" | "length" | "query" } {
  if (typeof raw !== "string" || !raw.length || raw.length > URL_LIMIT) return { ok: false, reason: "length" };
  for (const character of raw) {
    const code = character.charCodeAt(0);
    if (code < 33 || code >= 127) return { ok: false, reason: "length" };
  }
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "scheme" }; }
  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credential" };
  // No query strings: nothing this boundary fetches is parameterized, and a
  // query is a ready channel for smuggling credentials or private excerpts.
  if (url.search) return { ok: false, reason: "query" };
  if (url.port && url.port !== "443") return { ok: false, reason: "port" };
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!allowlist.some(entry => entry.toLowerCase() === host)) return { ok: false, reason: "host" };
  return { ok: true, url };
}

// Address validation, pure: true only for addresses this boundary treats as
// public. Denied: unspecified, loopback, private, link-local (including the
// 169.254.169.254 metadata service), CGNAT 100.64/10, unique-local fc00::/7,
// IPv6 link-local fe80::/10, multicast and the reserved/broadcast IPv4 tail.
// IPv4-mapped IPv6 revalidates the embedded IPv4 address. The documentation
// ranges 192.0.2/24 and 203.0.113/24 stay allowed on purpose: the synthetic
// fixtures use them as clearly-non-routable PUBLIC stand-ins.
export function publicAddress(address: string): boolean {
  return addressDenial(address) === null;
}
// Expand a (possibly compressed) IPv6 literal into eight numeric hextets.
// A dotted IPv4 tail is legal only as the final token and occupies two
// hextets; anything malformed returns null so callers fail closed.
function expandHextets(value: string): number[] | null {
  const pieces = value.split("::");
  if (pieces.length > 2) return null;
  const toHextets = (segment: string, allowDottedTail: boolean): number[] | null => {
    if (!segment) return [];
    const tokens = segment.split(":");
    if (allowDottedTail && tokens[tokens.length - 1].includes(".")) {
      const octets = tokens[tokens.length - 1].split(".").map(Number);
      if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
      tokens.splice(tokens.length - 1, 1, ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
    }
    const hextets: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/u.test(token)) return null;
      hextets.push(Number.parseInt(token, 16));
    }
    return hextets;
  };
  const head = toHextets(pieces[0], pieces.length === 1);
  const tail = pieces.length === 2 ? toHextets(pieces[1], true) : [];
  if (head === null || tail === null) return null;
  if (pieces.length === 2) {
    const missing = 8 - head.length - tail.length;
    return missing >= 0 ? [...head, ...Array.from({ length: missing }, () => 0), ...tail] : null;
  }
  return head.length === 8 ? head : null;
}

export function addressDenial(address: string): FetchDenyReason | null {
  const value = address.trim().toLowerCase();
  if (!value.length) return "ip";
  if (value.includes(":")) {
    const hextets = expandHextets(value);
    if (!hextets) return "ip"; // malformed: fail closed
    const first = hextets[0];
    if ((first & 0xfe00) === 0xfc00) return "ip"; // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return "ip"; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return "ip"; // ff00::/8 multicast
    // High 80 bits zero: the effective address is an embedded IPv4 tail —
    // v4-mapped in dotted or hex form (hextet 5 = ffff), or the deprecated
    // IPv4-compatible ::/96 form (covers ::, ::1 and every full-form
    // variant). Revalidate the embedded address itself.
    if (hextets.slice(0, 5).every(hextet => hextet === 0) && (hextets[5] === 0 || hextets[5] === 0xffff)) {
      const embedded = hextets[6] * 0x10000 + hextets[7];
      const dotted = `${Math.floor(embedded / 2 ** 24) & 0xff}.${Math.floor(embedded / 2 ** 16) & 0xff}.${Math.floor(embedded / 2 ** 8) & 0xff}.${embedded & 0xff}`;
      return addressDenial(dotted);
    }
    return null;
  }
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return "ip";
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return "ip";
  if (a === 100 && b >= 64 && b <= 127) return "ip"; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return "ip"; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return "ip";
  if (a === 192 && b === 168) return "ip";
  if (a >= 224) return "ip"; // multicast + reserved + limited broadcast
  return null;
}

// Denial signal thrown by resolvers, as plain data (the lint policy bans
// class declarations): an Error carrying a content-free denyReason.
export type AddressDeniedError = Error & { denyReason: FetchDenyReason };
export function addressDenied(reason: FetchDenyReason): AddressDeniedError {
  return Object.assign(new Error("Address denied"), { denyReason: reason });
}
export function isAddressDenied(error: unknown): error is AddressDeniedError {
  return typeof error === "object" && error !== null && "denyReason" in error;
}

// Production resolver: stdlib DNS with every answer validated. If ANY resolved
// address falls in a denied range the whole lookup is denied (a name that
// sometimes answers private never fetches), and the returned address is the
// one the transport will connect to — the connection is bound to the
// validated address, not to a second lookup.
export async function resolvePublicAddress(host: string): Promise<string> {
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(host) || host.includes(":")) {
    const denial = addressDenial(host);
    if (denial) throw addressDenied(denial);
    return host;
  }
  const answers = await dnsLookup(host, { all: true });
  if (!answers.length) throw new Error("Unresolvable host");
  for (const answer of answers) {
    const denial = addressDenial(answer.address);
    if (denial) throw addressDenied(denial);
  }
  return answers[0].address;
}

// Production transport: node stdlib https with a custom lookup that returns
// exactly the validated address (never re-resolving), TLS server name pinned
// to the allowlisted hostname so certificate validation still targets the
// name, and a fixed header allowlist — no credential or cookie forwarding.
export function createNodeTransport(): FetchTransport {
  return (url, validatedAddress, signal) => new Promise<TransportResponse>((resolvePromise, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        signal,
        servername: url.hostname,
        family: validatedAddress.includes(":") ? 6 : 4,
        lookup: (hostname, _options, callback) => {
          if (hostname !== url.hostname) callback(new Error("Transport host mismatch"), "");
          else callback(null, validatedAddress, validatedAddress.includes(":") ? 6 : 4);
        },
        headers: {
          accept: "text/plain;q=0.9, text/*;q=0.8, */*;q=0.5",
          "user-agent": "private-study-tracer/0.1 bounded-source-fetch",
        },
      },
      response => {
        resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: response });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type BoundedFetchConfig = {
  allowlist: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
};

// The bounded fetcher. Manual redirect following: every hop (including the
// first request) revalidates URL shape and resolves + validates the address
// again; a hop beyond the redirect budget, or any hop that fails validation,
// denies. Bodies are capped by Content-Length when declared and by a streamed
// byte cap always. The overall deadline spans every hop, and every await is
// raced against the deadline so an abort-ignoring transport or body cannot
// hang the fetch past its bound (the openai-compatible adapter's pattern).
export function createBoundedFetch(
  config: BoundedFetchConfig,
  deps: { transport?: FetchTransport; resolve?: AddressResolver } = {},
): BoundedFetchPort {
  const transport = deps.transport ?? createNodeTransport();
  const resolveAddress = deps.resolve ?? resolvePublicAddress;
  const failure = (code: BoundedFetchFailureCode, message: string, reason?: FetchDenyReason): BoundedFetchFailure =>
    reason === undefined ? { ok: false, code, message } : { ok: false, code, reason, message };
  return {
    async fetch(target: string): Promise<BoundedFetchResult> {
      const initial = validateFetchUrl(target, config.allowlist);
      if (!initial.ok) return failure("denied", "Target denied before any connection.", initial.reason);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      // The race partner: rejected exactly once on deadline. Promise.race
      // attaches a handler to it, so a post-success abort is never unhandled.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Fetch deadline exceeded")), { once: true });
      });
      const hops: string[] = [];
      try {
        let current = initial.url;
        for (let hop = 0; ; hop += 1) {
          // Revalidate scheme + allowlist on EVERY hop (the initial target was
          // validated above; each redirect target is validated here).
          const check = validateFetchUrl(current.toString(), config.allowlist);
          if (!check.ok) return failure("denied", hop === 0 ? "Target denied before any connection." : "Redirect target denied.", check.reason);
          let address: string;
          try {
            address = await Promise.race([resolveAddress(check.url.hostname.toLowerCase().replace(/\.$/u, "")), aborted]);
          } catch (error) {
            if (controller.signal.aborted) return failure("timeout", "Fetch timed out.");
            if (isAddressDenied(error)) return failure("denied", "Resolved address denied.", error.denyReason);
            return failure("transport", "Host resolution failed.");
          }
          // Defense in depth: the fetcher itself re-validates whatever the
          // resolver returned — the transport then connects to exactly this
          // validated address, never re-resolving it.
          const resolved = addressDenial(address);
          if (resolved) return failure("denied", "Resolved address denied.", resolved);
          let response: TransportResponse;
          try {
            response = await Promise.race([transport(check.url, address, controller.signal), aborted]);
          } catch {
            if (controller.signal.aborted) return failure("timeout", "Fetch timed out.");
            return failure("transport", "Fetch transport failed.");
          }
          if (response.status >= 300 && response.status < 400) {
            const location = headerValue(response.headers, "location");
            if (!location) return failure("denied", "Redirect without a location.", "redirect");
            if (hop >= config.maxRedirects) return failure("denied", "Too many redirects.", "redirect");
            let next: URL;
            try { next = new URL(location, check.url); } catch { return failure("denied", "Unparseable redirect location.", "redirect"); }
            hops.push(next.toString());
            current = next;
            continue;
          }
          if (response.status < 200 || response.status >= 300) return failure("status", `Source responded with status ${response.status}.`);
          const declared = headerValue(response.headers, "content-length");
          if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > config.maxBytes))
            return failure("denied", "Declared content exceeds the byte cap.", "size");
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          const body = response.body[Symbol.asyncIterator]();
          try {
            while (true) {
              const chunk = await Promise.race([body.next(), aborted]);
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > config.maxBytes) return failure("denied", "Content exceeds the streamed byte cap.", "size");
              chunks.push(chunk.value);
            }
          } catch {
            if (controller.signal.aborted) return failure("timeout", "Fetch timed out.");
            return failure("transport", "Fetch body failed.");
          }
          const merged = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
          return {
            ok: true,
            url: check.url.toString(),
            origin: check.url.hostname.toLowerCase(),
            status: response.status,
            text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
            contentHash: createHash("sha256").update(merged).digest("hex"),
            retrievedAt: new Date().toISOString(),
            hops,
          };
        }
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}

// Operator-owned live admission (F-B). The file is git-ignored local state in
// the ai-provider.json pattern: absent or invalid means NO live fetch — never
// a guessed allowlist. Nothing in this build writes or reads it outside these
// functions, and no gate or default path calls createLiveBoundedFetch.
const sourceFetchConfigSchema = z.strictObject({
  allowlist: z.array(z.string().trim().toLowerCase().min(4).max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u)).min(1).max(32),
  maxBytes: z.number().int().min(1024).max(4 * 1024 * 1024).default(1024 * 1024),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
  maxRedirects: z.number().int().min(0).max(3).default(2),
});
export type SourceFetchConfig = z.infer<typeof sourceFetchConfigSchema>;

export async function loadSourceFetchConfig(path = resolve(".local/source-fetch.json")): Promise<SourceFetchConfig | null> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  try {
    const parsed = sourceFetchConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

// Complete live wiring behind the F-B gate: with no admitted configuration
// this resolves to null and callers report the honest `fetch-unavailable`.
export async function createLiveBoundedFetch(): Promise<BoundedFetchPort | null> {
  const config = await loadSourceFetchConfig();
  if (!config) return null;
  return createBoundedFetch(config);
}

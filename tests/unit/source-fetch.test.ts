import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  addressDenial,
  createBoundedFetch,
  createLiveBoundedFetch,
  loadSourceFetchConfig,
  publicAddress,
  validateFetchUrl,
  type BoundedFetchConfig,
  type FetchTransport,
} from "../../src/adapters/source-fetch";
import {
  FIXTURE_FETCH_ALLOWLIST,
  createFixtureFetchPort,
  fixtureClaimedPassageFor,
  fixtureFetchedContentFor,
  fixtureMarkerFor,
  fixturePathFor,
} from "../../src/modules/course-generation/supplements";

// Local synthetic coverage of the AD-11 bounded fetch boundary's PURE halves:
// URL/address validation, the redirect/size/credential/deadline guard matrix
// over injected fake transports (zero network — no resolver or transport here
// ever touches a socket), the operator config loader, and the zero-egress
// fixture fetch port's determinism.

const allowlist = ["docs.example.org", "guide.example.org"] as const;
const config: BoundedFetchConfig = { allowlist, maxBytes: 1024, timeoutMs: 200, maxRedirects: 2 };
const resolvePublic = async () => "203.0.113.10";

function textBody(text: string): AsyncIterable<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return (async function* generator() { yield encoded; })();
}
const okTransport = (body: string, headers: Record<string, string> = {}): FetchTransport =>
  async () => ({ status: 200, headers: { "content-type": "text/plain", ...headers }, body: textBody(body) });
// Curried: fetcher(transport) returns a callable (url) => result over that transport.
const fetcher = (transport: FetchTransport) => {
  const port = createBoundedFetch(config, { transport, resolve: resolvePublic });
  return (url: string) => port.fetch(url);
};

describe("fetch URL validation (before any resolution or connection)", () => {
  it("accepts exactly allowlisted HTTPS hosts, with or without the default port", () => {
    expect(validateFetchUrl("https://docs.example.org/notes/a", allowlist)).toMatchObject({ ok: true });
    expect(validateFetchUrl("https://docs.example.org:443/notes/a", allowlist)).toMatchObject({ ok: true });
    expect(validateFetchUrl("https://DOCS.example.org/notes/a", allowlist)).toMatchObject({ ok: true });
  });
  it("denies non-HTTPS schemes", () => {
    expect(validateFetchUrl("http://docs.example.org/x", allowlist)).toMatchObject({ ok: false, reason: "scheme" });
    expect(validateFetchUrl("ftp://docs.example.org/x", allowlist)).toMatchObject({ ok: false, reason: "scheme" });
    expect(validateFetchUrl("docs.example.org/x", allowlist)).toMatchObject({ ok: false, reason: "scheme" });
  });
  it("denies credentials and query strings in the URL", () => {
    expect(validateFetchUrl("https://user:pass@docs.example.org/x", allowlist)).toMatchObject({ ok: false, reason: "credential" });
    expect(validateFetchUrl("https://docs.example.org/x?token=secret", allowlist)).toMatchObject({ ok: false, reason: "query" });
    expect(validateFetchUrl("https://docs.example.org/x?", allowlist)).toMatchObject({ ok: true }); // empty search is not a query
  });
  it("denies hosts outside the allowlist and non-standard ports", () => {
    expect(validateFetchUrl("https://evil.example.org/x", allowlist)).toMatchObject({ ok: false, reason: "host" });
    // A suffix/wildcard must NOT match an allowlisted parent.
    expect(validateFetchUrl("https://sub.docs.example.org/x", allowlist)).toMatchObject({ ok: false, reason: "host" });
    expect(validateFetchUrl("https://docs.example.org:8443/x", allowlist)).toMatchObject({ ok: false, reason: "port" });
  });
  it("denies oversized or non-printable targets", () => {
    expect(validateFetchUrl(`https://docs.example.org/${"a".repeat(2100)}`, allowlist)).toMatchObject({ ok: false, reason: "length" });
    expect(validateFetchUrl("https://docs.example.org/a b", allowlist)).toMatchObject({ ok: false, reason: "length" });
    expect(validateFetchUrl("https://docs.example.org/a\u0000b", allowlist)).toMatchObject({ ok: false, reason: "length" });
  });
});

describe("address validation (loopback/private/link-local/metadata/CGNAT denied)", () => {
  it("denies every range AD-11 names plus unspecified/multicast/reserved", () => {
    for (const address of [
      "127.0.0.1", "127.8.8.8",                       // loopback
      "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", // private
      "169.254.169.254", "169.254.0.1",               // link-local + cloud metadata
      "100.64.0.1", "100.127.255.255",                // CGNAT 100.64/10
      "0.0.0.0", "224.0.0.1", "255.255.255.255",      // unspecified/multicast/reserved
      "::", "::1",                                    // IPv6 unspecified/loopback (compressed)
      "0:0:0:0:0:0:0:0", "0:0:0:0:0:0:0:1",           // …and full-form
      "fc00::1", "fd12:3456::1",                      // fc00::/7 unique-local
      "fe80::1", "febf::1",                           // fe80::/10 link-local
      "ff02::1",                                      // multicast
      "::ffff:127.0.0.1", "::ffff:10.0.0.1",          // dotted v4-mapped revalidates inner
      "::ffff:7f00:1", "::ffff:a00:1",                // hex-form v4-mapped (127.0.0.1 / 10.0.0.1)
      "0:0:0:0:0:ffff:7f00:1",                        // full-form v4-mapped
      "::127.0.0.1", "::10.0.0.1",                    // IPv4-compatible embedded (dotted)
      "::a00:1", "::7f00:1", "::0a00:0001",           // IPv4-compatible embedded (hex, padded)
    ]) expect(addressDenial(address), address).toBe("ip");
    // Malformed literals fail closed too.
    for (const address of ["1:2:3:4:5:6:7:8:9", "1:2::3::4", "::ffff:1.2.3.4.5", "fe80:", "gg::1"])
      expect(addressDenial(address), address).toBe("ip");
  });
  it("allows public addresses (including the fixture documentation range)", () => {
    for (const address of [
      "8.8.8.8", "93.184.216.34", "203.0.113.10", "192.0.2.5", "2606:4700::1111",
      "::ffff:8.8.8.8", "::ffff:808:808",             // v4-mapped of a PUBLIC address (dotted + hex)
      "2001:4860:4860::8888", "1:2:3:4:5:6:7:8",      // ordinary global unicast, full form
    ]) expect(publicAddress(address), address).toBe(true);
  });
});

describe("bounded fetch guard matrix over injected transports (zero network)", () => {
  it("fetches a bounded 200 response with hash, origin and retrieval time", async () => {
    const body = "Public reference note: verified content — documented with examples.";
    const result = await fetcher(okTransport(body))("https://docs.example.org/notes/a");
    expect(result).toMatchObject({ ok: true, origin: "docs.example.org", status: 200, text: body, hops: [] });
    if (!result.ok) return;
    expect(result.contentHash).toBe(createHash("sha256").update(new TextEncoder().encode(body)).digest("hex"));
    expect(Number.isNaN(Date.parse(result.retrievedAt))).toBe(false);
  });
  it("denies a private/reserved resolved address before any transport call (rebinding)", async () => {
    let called = false;
    const transport: FetchTransport = async () => { called = true; return { status: 200, headers: {}, body: textBody("x") }; };
    const privateFetcher = createBoundedFetch(config, { transport, resolve: async () => "10.0.0.7" });
    const result = await privateFetcher.fetch("https://docs.example.org/notes/a");
    expect(result).toMatchObject({ ok: false, code: "denied", reason: "ip" });
    expect(called).toBe(false); // denied BEFORE the connection
  });
  it("revalidates every redirect hop: scheme, allowlist and budget", async () => {
    const redirectTo = (location: string): FetchTransport =>
      async () => ({ status: 302, headers: { location }, body: textBody("") });
    expect(await fetcher(redirectTo("http://docs.example.org/x"))("https://docs.example.org/notes/a"))
      .toMatchObject({ ok: false, code: "denied", reason: "scheme" });
    expect(await fetcher(redirectTo("https://169.254.169.254/latest"))("https://docs.example.org/notes/a"))
      .toMatchObject({ ok: false, code: "denied", reason: "host" });
    // One VALID hop lands on the redirected page after revalidation.
    const redirectOnce: FetchTransport = async url =>
      url.hostname === "docs.example.org"
        ? { status: 302, headers: { location: "https://guide.example.org/final" }, body: textBody("") }
        : { status: 200, headers: {}, body: textBody("final page") };
    expect(await fetcher(redirectOnce)("https://docs.example.org/notes/a"))
      .toMatchObject({ ok: true, origin: "guide.example.org", hops: ["https://guide.example.org/final"] });
    // A redirect chain beyond the budget denies as redirect, never fetches unbounded.
    const loop: FetchTransport = async url => ({ status: 302, headers: { location: `${url}/more` }, body: textBody("") });
    expect(await fetcher(loop)("https://docs.example.org/notes/a")).toMatchObject({ ok: false, code: "denied", reason: "redirect" });
    expect(await fetcher(async () => ({ status: 302, headers: {}, body: textBody("") }))("https://docs.example.org/notes/a"))
      .toMatchObject({ ok: false, code: "denied", reason: "redirect" });
  });
  it("denies oversize responses by declared length and by streamed bytes", async () => {
    expect(await fetcher(okTransport("x", { "content-length": "2048" }))("https://docs.example.org/notes/a"))
      .toMatchObject({ ok: false, code: "denied", reason: "size" });
    expect(await fetcher(okTransport("x", { "content-length": "12abc" }))("https://docs.example.org/notes/a"))
      .toMatchObject({ ok: false, code: "denied", reason: "size" });
    const streaming: FetchTransport = async () => ({
      status: 200,
      headers: {},
      body: (async function* generator() { for (let round = 0; round < 4; round += 1) yield new Uint8Array(512).fill(65); })(),
    });
    expect(await fetcher(streaming)("https://docs.example.org/notes/a")).toMatchObject({ ok: false, code: "denied", reason: "size" });
  });
  it("fails transport and non-2xx statuses honestly", async () => {
    const throwing: FetchTransport = async () => { throw new Error("socket"); };
    expect(await fetcher(throwing)("https://docs.example.org/notes/a")).toMatchObject({ ok: false, code: "transport" });
    const notFound: FetchTransport = async () => ({ status: 404, headers: {}, body: textBody("") });
    expect(await fetcher(notFound)("https://docs.example.org/notes/a")).toMatchObject({ ok: false, code: "status" });
  });
  it("bounds the total deadline even against a transport that never settles", async () => {
    const silent: FetchTransport = () => new Promise(() => { /* ignores abort on purpose */ });
    const result = await fetcher(silent)("https://docs.example.org/notes/a");
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });
});

describe("operator admission config (F-B)", () => {
  it("loads nothing without an admitted file and never guesses an allowlist", async () => {
    expect(await loadSourceFetchConfig()).toBeNull(); // no .local/source-fetch.json in this build
    expect(await loadSourceFetchConfig(resolve(".local/definitely-absent-source-fetch.json"))).toBeNull();
    expect(await createLiveBoundedFetch()).toBeNull(); // honest fetch-unavailable wiring
  });
  it("accepts a strict admitted config and rejects malformed ones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "source-fetch-"));
    try {
      const valid = join(directory, "valid.json");
      await writeFile(valid, JSON.stringify({ allowlist: ["docs.example.org"], maxBytes: 4096, timeoutMs: 5000, maxRedirects: 1 }), "utf8");
      expect(await loadSourceFetchConfig(valid)).toEqual({ allowlist: ["docs.example.org"], maxBytes: 4096, timeoutMs: 5000, maxRedirects: 1 });
      const invalid = join(directory, "invalid.json");
      await writeFile(invalid, "{not json", "utf8");
      expect(await loadSourceFetchConfig(invalid)).toBeNull();
      const badHost = join(directory, "bad-host.json");
      await writeFile(badHost, JSON.stringify({ allowlist: ["https://docs.example.org"] }), "utf8");
      expect(await loadSourceFetchConfig(badHost)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("zero-egress fixture fetch port (the default of this build)", () => {
  it("serves deterministic, hash-stable content for the same URL", async () => {
    const port = createFixtureFetchPort();
    const url = "https://docs.example.org/notes/unit-testing-fundamentals";
    const first = await port.fetch(url);
    const second = await port.fetch(url);
    expect(first).toMatchObject({ ok: true, origin: "docs.example.org", status: 200 });
    // Pure function of the URL — retrievedAt is a per-fetch timestamp, so the
    // two results must agree on everything except it.
    expect(second).toEqual({ ...first, retrievedAt: second.retrievedAt });
    if (!first.ok) return;
    const claimed = fixtureClaimedPassageFor(new URL(url));
    expect(fixtureFetchedContentFor(new URL(url))).toContain(claimed);
    expect(first.text).toContain(claimed);
  });
  it("runs the marker rows through the real boundary: unsupported, conflict text, denials", async () => {
    const port = createFixtureFetchPort();
    const unsupportedUrl = `https://docs.example.org${fixturePathFor("One unverifiable claim exists about coverage.")}`;
    expect(fixtureMarkerFor("One unverifiable claim exists about coverage.")).toBe("unverifiable");
    const unsupported = await port.fetch(unsupportedUrl);
    expect(unsupported).toMatchObject({ ok: true });
    if (unsupported.ok) expect(unsupported.text).not.toContain(fixtureClaimedPassageFor(new URL(unsupportedUrl)));
    const conflictingUrl = `https://docs.example.org${fixturePathFor("A conflicting statement about doubles and dependencies appears.")}`;
    expect(fixtureClaimedPassageFor(new URL(conflictingUrl))).toContain("not the case");
    const rebinding = await port.fetch(`https://rebind.example.org${fixturePathFor("A rebinding host hides a private address.")}`);
    expect(rebinding).toMatchObject({ ok: false, code: "denied", reason: "ip" }); // allowlisted name, private address
    const oversized = await port.fetch(`https://docs.example.org${fixturePathFor("An oversized page exceeds the cap.")}`);
    expect(oversized).toMatchObject({ ok: false, code: "denied", reason: "size" });
    const looping = await port.fetch(`https://docs.example.org${fixturePathFor("A looping redirect never settles.")}`);
    expect(looping).toMatchObject({ ok: false, code: "denied", reason: "redirect" });
    const unfetchable = await port.fetch(`https://docs.example.org${fixturePathFor("An unfetchable page errors.")}`);
    expect(unfetchable).toMatchObject({ ok: false, code: "transport" });
    const redirected = await port.fetch(`https://docs.example.org${fixturePathFor("A redirected page moves once.")}`);
    expect(redirected).toMatchObject({ ok: true, origin: "docs.example.org" });
    if (redirected.ok) expect(redirected.url).toContain("/notes/final/");
  });
  it("keeps the fixture allowlist inside reserved documentation hosts only", () => {
    for (const host of FIXTURE_FETCH_ALLOWLIST) expect(host.endsWith(".example.org")).toBe(true);
  });
});

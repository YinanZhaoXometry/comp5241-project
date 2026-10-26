# Bounded public-source fetch and attributed supplementation

## Status and scope

This is the epic-2 S2 fetch boundary plus its fixture mode, implemented under
the approved story plan
(`_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/tickets/story-bounded-source-retrieval-and-attributed-supplementation-plan.md`).
**No live network fetch exists in this build.** Every automated gate and the
default worker path run the adapter over deterministic local fixtures with
zero egress; the live wiring is complete behind
[feasibility gate F-B](../_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md)
(network scope, source licensing/terms, rate limits, verification tooling and
operator authorization), which owns admission. The synthetic-fixture
development F-B explicitly permits is what ships here.

Two untrusted steps are kept structurally separate — this is what makes
"AI citation ≠ verification" a property of the pipeline, not a procedure:

1. **Proposal** (`src/modules/course-generation/supplements.ts`): the
   processor (local synthetic fixture by default) only ever *proposes*
   candidate sources — allowlisted host, path, a claim restating a plan gap,
   and the passage it expects on that page. The strict parser resolves every
   link against the confirmed plan and the generated course, rejects
   unallowlisted hosts, drifting claims and partial gap coverage, and
   canonicalizes the claim to the plan's own gap text.
2. **Verification** (same file, deterministic): the bounded fetcher retrieves
   the candidate; a supplement persists only when its claimed passage is
   lexically contained in the fetched bytes (verbatim modulo case/whitespace)
   AND supports the gap's claim (significant-term overlap). A fetch success,
   a citation's existence, or model agreement is never verification. A
   conflict is recorded only when an upload sentence and a passage sentence
   share at least two significant terms while exactly one side negates — both
   sources then render side by side and are never silently resolved.
   Everything else stays `supported`; an unfindable passage is the honest
   `unsupported` state with **no content persisted** and no scored item.

## The fetch boundary (`src/adapters/source-fetch.ts`)

Stdlib-only (`node:dns`, `node:https`), transport-injectable (the
`openai-compatible` adapter's pattern) so the full guard matrix is unit-tested
with zero network. In order:

| Guard | Rule |
| --- | --- |
| URL shape | HTTPS only; exact-host allowlist (no suffix/wildcard matching); no credentials in URL; no query strings (nothing this boundary fetches is parameterized); standard port only; printable ASCII ≤ 2048 chars. Checked before any resolution. |
| Address | DNS answers validated; deny unspecified, loopback, private (10/8, 172.16/12, 192.168/16), link-local incl. `169.254.169.254`, CGNAT `100.64/10`, `fc00::/7`, `fe80::/10`, multicast and the reserved IPv4 tail. IPv4-mapped IPv6 revalidates the inner address. If ANY resolved address is denied, the lookup is denied. |
| Binding | The production transport connects through a custom `lookup` that returns exactly the validated address (DNS is never re-consulted at connect time), with TLS server name pinned to the allowlisted hostname — DNS rebinding between check and connect cannot redirect the connection. |
| Redirects | Manual following; EVERY hop re-runs scheme + allowlist + DNS/IP validation; a missing/unparseable location, a hop beyond the redirect budget (default 2) or any denied target denies the whole fetch. |
| Size | Declared `Content-Length` over the cap denies before body handling; the streamed byte cap (fixture default 128 KiB) denies mid-body regardless of headers. |
| Credentials | No credential or cookie forwarding; a fixed header allowlist with the honest product User-Agent. |
| Deadline | One total deadline across all hops (default 10 s fixture / ≤ 30 s live); every await races the deadline so an abort-ignoring transport cannot hang the fetch. |

Failure results are content-free: `{ ok: false, code, reason?, message }` with
`code ∈ denied | timeout | transport | status | unavailable` and
`reason ∈ scheme | credential | host | port | length | ip | redirect | size`.
The worker maps them to honest request failures
(`fetch-denied:<reason>`, `fetch-timeout`, `fetch-transport`, `fetch-status`,
`fetch-unavailable`); fetch failures never persist supplement rows.

## Live admission (F-B) — deliberately not active

Live configuration is operator-owned git-ignored
`.local/source-fetch.json` (the `ai-provider.json` pattern):

```json
{ "allowlist": ["host.example.org"], "maxBytes": 1048576, "timeoutMs": 10000, "maxRedirects": 2 }
```

`loadSourceFetchConfig()` returns `null` when the file is absent or malformed
— never a guessed allowlist — and `createLiveBoundedFetch()` then returns
`null`, which any future wiring must translate to the honest
`fetch-unavailable`. **The file does not exist in this repository and nothing
in this build reads a live endpoint.** Before any live call, F-B additionally
requires: per-source licensing/robots/terms evidence, rate limits, retention
and content-verification decisions, and the operator's explicit egress
authorization. Protocol completeness of this adapter is not that evidence.

## Fixture mode (the default of this build)

`createFixtureFetchPort()` runs the REAL `createBoundedFetch` validation over
a deterministic fake transport and resolver — URL, allowlist, per-redirect,
IP and size denials all execute for real; only the socket is fake:

- **Allowlist:** `docs.example.org`, `standards.example.org`,
  `guide.example.org`, `rebind.example.org` (reserved documentation hosts).
- **Addresses:** `203.0.113.10–12` (TEST-NET-3) for the public hosts;
  `rebind.example.org` deliberately resolves `10.0.0.7` so the
  allowlisted-name/private-address (rebinding) denial is reachable through
  the default path.
- **Content:** a pure function of the URL (hash-stable). The synthetic
  proposal fixture derives the same passage from its prompt, so the happy
  path verifies end-to-end without egress.
- **Marker rows** — a marker word inside a gap description selects a fixture
  behavior so every display state is reachable:

| Marker word in the gap | Fixture behavior | Display state |
| --- | --- | --- |
| `conflicting` | passage contains a negated contrary sentence | side-by-side conflict |
| `unverifiable` | fetched page does not contain the claimed passage | honest unsupported |
| `unfetchable` | transport error | honest retryable failure (`fetch-transport`) |
| `oversized` | body over the streamed cap | `fetch-denied:size` |
| `rebinding` | allowlisted host resolves private | `fetch-denied:ip` |
| `redirected` | one valid redirect hop | per-hop revalidation success |
| `looping` | self-redirect | `fetch-denied:redirect` |

No marker word → the supported default. These markers are test fixtures, not
product behavior; a live processor's proposals are subject to the same
validation and verification.

## Persistence, lifecycle and consent

- Migration `016` (additive, idempotent): processor configuration **v6**
  widens the consented purpose cumulatively — the proposal input now includes
  *gap descriptions* and *generated-lesson summaries*. Existing v5 grants
  honestly lapse; one owner re-grant under the v6 disclosure gates the
  supplement pass (and course generation, which shares the purpose).
- `app.supplement_request` — one tracked pass per command (admission UNIQUE,
  terminal-monotonic statuses, restart-safe queue job `supplement-fetch-v1`,
  id = request id, retryLimit 0, 120 s cap, stranded-pending self-heal).
- `app.course_supplement` — rows only on definite checked outcomes:
  `supported`/`conflict` carry passage, locator, content hash and retrieval
  time (CHECK-enforced); `unsupported` persists no content; conflicts keep
  both the upload excerpt and the fetched passage.
- `'supplement'` lifecycle objects are parented to the course's own object,
  inheriting its lineage fences; root/personal deletion purges the request
  and rows through the course `ON DELETE CASCADE` and the lifecycle port's
  preview counts a `supplements` category.
- The export surface lists a `supplements` category and records a deliberate
  skip in the manifest (fetched external passages and conflict excerpts are
  not exported; inclusion is entry 8's scope decision).
- No scored/practice semantics exist anywhere on this path, and supplements
  never rewrite or replace the learner's uploads.

## Verification

- `npm run test -- tests/unit/source-fetch.test.ts` — validator matrix,
  redirect/size/credential/deadline guards over fake transports, config
  loader honesty, fixture determinism and marker rows.
- `npm run test -- tests/unit/course-generation.test.ts` — gap derivation,
  strict proposal parsing, verification/conflict units, fixture round trip.
- `npm run test:integration` — happy/conflict/unsupported flows, fetch
  failure codes and retries, consent-blocked zero effect, cross-owner and
  ungenerated denials, replay/duplicate/stranded self-heal, mid-flight
  withdrawal, purge, export skip.
- `npm run test:e2e` — badge, side-by-side conflict, unsupported and honest
  failure journey at 360px with keyboard operation and a zero-outbound
  assertion.
- `npm run test:restart` — supplement job queued without a worker completes
  exactly once across a real restart.

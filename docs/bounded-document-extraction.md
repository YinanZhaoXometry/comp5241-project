# Story 2 extraction — implementation and replacement assessment

## Current disposition

**Local synthetic gate passed; independent review completed and its findings fixed.** Story 2 was approved for local synthetic implementation
on 2026-10-21. Four-format ingestion, durable ordered batches, explicit immutable
source acknowledgment and transitive plan invalidation are implemented locally.
The independent Quick review (2026-10-21) returned one decision and four patch
findings; all five were fixed with regression tests on 2026-10-22 and the full
gate re-passed (see "Re-admission on fixed musl" below). No live provider is
connected and no deployment/real-data use is authorized.

## Re-admission on fixed musl (2026-10-22)

The unchanged image failed its scheduled Trivy audit on 2026-10-22: the updated
scanner database flags **CVE-2026-107891** against `musl 1.2.6-r2` and
`musl-utils 1.2.6-r2` in the pinned Alpine 3.24.2 base. The advisory had no
public details yet (severity unclassified), but Alpine's fixed `1.2.6-r3` was
already published. Consistent with the Expat precedent, the fixed release is
pinned exactly in both Dockerfile stages (`musl=1.2.6-r3 musl-dev=1.2.6-r3` in
the build stage; `musl=1.2.6-r3 musl-utils=1.2.6-r3` in the runtime stage).
libxml2/libxslt/lxml were rebuilt from the same hash-verified sources against the
fixed libc; every version/isolation/XMP/resource probe, the four at-limit
fixtures and the hostile DOCX observations re-passed, the audit is empty again
and fresh admission was written. The image digest and fingerprint changed; the
quarantined Expat admission remains rejected. This is a maintenance pin of an
already-admitted component, not a new risk waiver.

Also on 2026-10-22 the gate's `migrate` step refused with "Applied migration
changed": an editor had appended a trailing newline to both applied migration
files after the last passing gate. The byte-exact applied content was restored
(the recorded hashes match HEAD's `001` and the un-newlined `002`); the hash
check itself was not relaxed. Do not add whitespace to an applied migration.

The dependency-source recheck found a blocker **after** initial synthetic tests:
the image bundles Expat 2.8.5. The [official 2.9.0 change log](https://raw.githubusercontent.com/libexpat/libexpat/R_2_9_0/expat/Changes)
lists CVE-2026-102633 (32-bit realloc overflow) and CVE-2026-77214
(`XML_ParseBuffer` capacity validation). This deployment is 64-bit aarch64;
the [pinned CPython binding](https://raw.githubusercontent.com/python/cpython/v3.14.8/Modules/pyexpat.c)
uses `XML_Parse` for our `Parse(bytes)` calls, not the binding's `ParseFile`
buffer API. Those facts narrow the published issues' reachability, but are **not**
a waiver for the [upstream unresolved non-public security issues](https://github.com/libexpat/libexpat/issues/1160).
Upstream lists validated unresolved issues without enough public detail to establish
this configuration's non-applicability. A clean image scan cannot settle that gap.

The prior admission was quarantined locally as
`.local/parser-admission-blocked-20261021.json`; it must never be restored.
Worker/parser readiness fails closed without fresh matching admission. The old
version gate deliberately rejected that image before further document fixtures.
Updating Expat to 2.9.0 is necessary for its published fixes but **not sufficient**
to resolve the non-public-issue uncertainty. Do not bypass that assertion, copy the
quarantined admission back, or silently extend the Node-only exception.

The human selected **“Assess a non-Expat replacement and continue.”** No further
Story 2 approval or new risk waiver was inferred. A source-built replacement now
passes six focused isolated regressions and the full synthetic gate;
independent review remains pending. Do not report Story 2, F1 or release readiness
passed on that focused evidence.

## Non-Expat replacement assessment (2026-10-21)

- **Wheel rejected:** the exact standard CPython 3.14 musllinux/aarch64 lxml
  6.1.3 wheel (`83e3a51e7933db700a0da0db31849db3a24022d9970da9bb73001e1d0326fd92`)
  was built in an ignored assessment image and probed under the same sandbox.
  Runtime and compiled constants were libxml2 2.14.6/libxslt 1.1.43. It was not
  admitted. Recipe metadata alone was not accepted as binary-version evidence.
- **Source-built candidate:** lxml 6.1.3 links maintained libxml2 2.15.4 and
  libxslt 1.1.45 from hash-verified official sources. The Dockerfile pins direct
  compiler/build packages and setuptools 84.2.1; the final image retains build
  APK/version and source/wheel hash inventories plus native/package notices.
  Compiler, curl, setuptools and source archives stay in the builder, not runtime.
  Transitive APK resolution is recorded, not claimed to be a hermetic toolchain.
- **Advisory findings:** [lxml release history](https://raw.githubusercontent.com/lxml/lxml/lxml-6.1.3/CHANGES.txt)
  covers CVE-2026-41066 in 6.1.0 and parameter-entity fixes in 6.1.3.
  [libxml2 NEWS](https://raw.githubusercontent.com/GNOME/libxml2/v2.15.4/NEWS)
  places the CVE-2025-10911 XPath fix in 2.15.2 and `atype` corruption guard in
  2.14.6; 2.15.4 includes subsequent bounds/overflow/DTD fixes.
  [libxslt NEWS](https://raw.githubusercontent.com/GNOME/libxslt/v1.1.45/NEWS)
  includes CVE-2025-7424/11731 fixes (1.1.45 rebuilds 1.1.44).
  No remaining published conflict was identified in the assessed paths; this is
  not proof of absence of confidential issues or vulnerabilities.
- **Important upstream warning:** [libxml2's security statement](https://raw.githubusercontent.com/GNOME/libxml2/v2.15.4/README.md)
  explicitly discourages processing untrusted data and describes volunteer,
  best-effort maintenance. This assessment authorizes no real/untrusted upload
  activation, release, or new waiver. Only original controlled synthetic fixtures
  are exercised inside the pre-existing external hard isolation; broader use
  requires renewed architecture/security assessment of this warning.
- **XML boundary:** streaming target/feed, no built DOM, no DTD/entities/PIs,
  explicit rejecting resolver, no recovery/huge-tree/decompression. Catalog,
  network protocols, XML zlib/iconv/ICU are excluded; FTP/LZMA are already removed
  upstream. XInclude elements are rejected; uploads never invoke XSLT, XPath,
  schema or XInclude execution. Runtime ZIP still uses pinned zlib. lxml's
  `WITHOUT_ZLIB` alone does not remove its linker dependency.
- **PDF/XMP boundary:** pypdf imports Expat through its otherwise unused XMP
  implementation. The checked-in build-only patch verifies pristine XMP SHA256
  `0853e82701b820b96d14ecfdd9f49cf04f1a734ce2314ff0e9b16976e753d494`,
  removes that XML builder, and makes XMP construction/interpretation raise
  before stream decoding. It retains legacy constants/notices and updates wheel
  RECORD metadata. This is an explicit downstream restriction, not an upstream
  optional feature. No fake empty metadata or runtime monkey-patching. Raw XMP
  byte copying by unused writer APIs is not claimed disabled.
- **Expat absence scope:** pyexpat and `_elementtree` extensions are removed from
  the final merged rootfs; fresh actual imports of those modules, the stdlib
  Expat wrapper and DOM builder must fail. Loaded process maps must contain no
  Expat. Inherited OCI layer blobs still contain deleted base bytes, inaccessible
  to the normal mount-free confined process; this is not an Expat-free base image.
- **Executed focused evidence:** native runtime/compiled versions, failed imports,
  XMP fail-before-decode, unchanged PDF text with valid/malformed/entity/bomb XMP,
  UTF-16 strict Word namespace/CDATA/escaped Unicode and locations, hostile encoded
  DOCTYPE/parameter entities/PIs/XInclude, depth and namespace rejection: six
  isolated cases passed. Outside-process hostile observations remained networknone,
  mounts0, read-only, unchanged writable-layer paths and removed containers.
  Lint113/probes, boundaries and both typechecks also passed. Fresh full checks
  and resource probes then passed as recorded below.

## Implemented behavior

- **Inputs:** text PDF, DOCX, literal UTF-8 TXT/Markdown; 20 MiB per original,
  ten active slots per batch, including concurrent admission checks. No OCR,
  URLs, macros, embedded-code execution or generic archives.
- **Selection:** inspect each successful preview's locations/warnings, acknowledge
  exact extraction IDs, and explicitly exclude every other active slot. Failed,
  pending and unchecked files never silently become plan sources. Manual plans
  retain their complete immutable source set, not only a primary extraction ID.
- **State:** originals and content-free v1 jobs persist; duplicate commands replay
  one receipt. Cancel/retry generations fence late attempts. At 120 seconds the
  query exposes honest pending with the saved input and operation ID.
- **Deletion:** removing A invalidates and purges A+B derivatives while B remains
  usable. Protected streams recheck session and every ancestor per 16 KiB chunk.
  Already delivered client bytes cannot be recalled. General retention/restore
  remains later work.
- **Compatibility:** additive migration preserves singleton IDs, storage keys,
  exact saved plans and v1 queue envelopes. Runtime cannot migrate. Originals are
  binary-safe, authorized `application/octet-stream` attachments, never HTML/PDF
  embedded previews. Extracted Markdown remains escaped literal text.

## Candidate provenance and license inventory

The candidate is not host Poppler/libzip and does not execute the project's Python
tooling environment. It is an isolated official Python Linux image with one pinned
pure-Python PDF dependency, streaming native XML and stdlib ZIP.

| Component | Verified candidate version / provenance | License reference |
| --- | --- | --- |
| Python | 3.14.8, official linux/arm64 Alpine 3.24 image, base digest `sha256:aae362254cea6b75fe812f0b428f10b3b361a090fe5655fb1d03937f6d38cda9` | [PSF v2 and incorporated notices](https://docs.python.org/3.14/license.html) |
| pypdf | 6.21.1, wheel SHA256 `553e2d42f5bb3bb2a785a7d3de8ef90bb7df74b5413eff5a7b4388007ea9254b`; no extras/dependencies on this Python | [BSD-3-Clause](https://raw.githubusercontent.com/py-pdf/pypdf/6.21.1/LICENSE), [PyPI release metadata](https://pypi.org/pypi/pypdf/6.21.1/json) |
| lxml | 6.1.3 source SHA256 `45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21` | [BSD-3-Clause and incorporated notices](https://raw.githubusercontent.com/lxml/lxml/lxml-6.1.3/LICENSES.txt) |
| libxml2 | 2.15.4 source SHA256 `98087fd181d9070724f3fbc65c7377db03038eb92bd882374daff44940138821` | [MIT-style](https://raw.githubusercontent.com/GNOME/libxml2/v2.15.4/Copyright) |
| libxslt/libexslt | 1.1.45 source SHA256 `9acfe68419c4d06a45c550321b3212762d92f41465062ca4ea19e632ee5d216e` | [MIT-style incorporated notices](https://raw.githubusercontent.com/GNOME/libxslt/v1.1.45/Copyright) |
| zlib | loaded 1.3.2, Alpine package pinned `1.3.2-r1` | [zlib license](https://zlib.net/zlib_license.html) |
| Local isolation tools | Docker CLI 29.5.3, engine 29.5.2; Colima 0.10.3, Linux aarch64/cgroups v2 | Distribution licenses/notices remain in their packages; no images/binaries redistributed here |
| Scanner | Homebrew-installed Trivy 0.76.0; DB updated 2026-10-21 01:19:53 UTC | [Trivy project](https://trivy.dev/) |

The Dockerfile retains package metadata/notices; pip/ensurepip/cache are removed
from the final candidate. The original audit scanned 30 Alpine packages and one Python
package, with no reported vulnerabilities. **That missed the bundled-Expat gap**;
audit0 means no scanner findings, not absence of vulnerabilities. Before any
redistribution, preserve all image/package license obligations, not just the four
parser components named above. The replacement audit scanned the same 30 OS
packages plus pypdf/lxml and reported no vulnerabilities. The source-built native
versions, source checksums and loaded-library hashes are checked/recorded separately;
they are not claimed covered solely by that scanner.

## Isolation design and measured synthetic results

The fixed local Colima Unix daemon is inspected and source/audit hashes pin
admission. Runtime does not pull, build or scan. Containers have no mounts, secrets,
network or ports; nonroot 65532, read-only filesystem, no capabilities,
no-new-privileges and default-deny seccomp. Docker CLI environment is minimal,
not inherited application credentials. One active parser per worker; a database
advisory lock prevents overlapping worker instances during orphan reconciliation.

| Ceiling / probe | Fresh replacement observation (2026-10-21 08:29:54 UTC) |
| --- | --- |
| Hard memory 512 MiB, equal combined memory/swap limit | allocation probe OOM-killed, exit137, 473 ms |
| 1 CPU; hard CPU limit 10 s | CPU probe killed, 10,233 ms |
| Wall deadline 30 s | supervisor stopped/removed container, 30,152 ms |
| Output 20 MiB text + 256 KiB metadata + 4-byte frame | output probe stopped/removed, 487 ms |
| 16 PIDs, 64 FDs, no core dump | inspected limits; fork denied by seccomp; FD/CPU/nonroot probes passed |
| DOCX expansion | max2,048 entries; actual streamed64 MiB aggregate/32 MiB member; XML depth128; max2,048 locations; no disk unzip |
| Legal boundary | readable exact20-MiB TXT, Markdown (newline-dense), PDF and DOCX succeeded without truncated success |
| Hostile traversal/expansion/external/XXE-private-read | daemon-side networknone, mounts0, read-only, unchanged writable-layer paths, bounded elapsed415–488 ms, removed container and empty labeled inventory |

[Docker's hard-memory/swap semantics](https://docs.docker.com/engine/containers/resource_constraints/)
explain why equal memory/swap prevents swap. These are local measurements,
not a production load/SLA or kernel-escape certification. Hostile observations
are outside-process daemon inspection/diff/removal, supplemented by a direct
socket/private-read/write/fork denial probe; no packet-capture or syscall trace
claim is made. Image logs are disabled. Forced removal is mandatory even on
failure; killed-worker orphans are reconciled before readiness.

## Verification performed, not final acceptance

- **Fresh complete replacement gate:** `npm run checks` passed audit0, lint113/
  all negative and JSX-positive probes, boundaries, both types, unit110, isolated
  parser audit/probes/legal boundaries, ordered migrations, integration52,
  production build, all27 browser cases and real restart. No tests skipped.
  Local admission image `sha256:eb6172fb553b44144c560954eccd457e68b04a5bc09d62683b29e8d9cbdaa90e`;
  exact native inventory and patch hash are in ignored private-mode admission.
- **Matrix audit:** legal/invalid rows map to document/stack integration and
  contract cases; mixed-batch row to batch PG and browser selection cases;
  replay/race row to batch/tracer PG, browser stale/deletion cases and real
  queued-PDF restart. Every covering suite ran unfiltered in the full gate.
- **Passed before blocker discovery:** audit0; 113-rule lint mappings and probes;
  module/provider boundaries; both typechecks; 110 unit cases; 46 real integration
  cases including migration compatibility, four legal boundaries, hostile formats,
  selection forgery, delete/confirm/stream/cancel races, replay and pending status.
- **Browser:** original 10 tracer + 12 demo cases passed in the first full run.
  Initial new cases exposed a too-short assertion and a grouped sign-in throttle
  fixture; unchanged application limits were preserved. All five corrected batch
  cases then passed independently. A combined final 27-case run is still pending.
- **Real restart:** exact Manual plan/session survived stop/restart; another owner
  denied; a PDF uploaded with the worker stopped recovered its durable job after
  restart, retained the same original and one extraction, replayed one receipt,
  and removed roots; process output contained no fixture text or credentials.
- **RED→GREEN:** the new real outside-process observation test first failed with
  no observation, then passed with supervisor-side inspection and removal proof.
- **Not completed:** independent Quick review; broader real/untrusted-data,
  production/provider/retention/F1 readiness. The old Expat image is never re-admitted.

All fixtures are original generated non-personal synthetic content. No real
document, external account, paid resource, provider call, deployment, ticket
advancement, commit or remote operation was performed for this change.

## Local prerequisites and recovery

Use the [README runtime selection](../README.md#local-prerequisites-and-operation).
The candidate build additionally needs existing local Docker/Colima with the
default Unix socket, hard cgroup support and Trivy at the verified Homebrew paths.
Do not start an unrelated/default PostgreSQL cluster or expose a daemon TCP port.
Only the explicit extractor build may download the public pinned image/wheel and
scanner database. Runtime never falls back to native parsing if the daemon,
admission, audit, fingerprint or limits are missing/mismatched.

**Currently required:** extractor build checks exact replacement native versions,
disabled XMP/failed Expat imports, fresh audit and every isolation/resource probe
before issuing new local synthetic admission. Worker startup stops without matching
evidence. Never restore the quarantined old admission. Run the complete synthetic gate, finish independent
review, and restore matching Next development imports/cache after production checks.
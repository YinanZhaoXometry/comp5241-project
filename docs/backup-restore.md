# Backup and protective restore (S13) — local configuration and procedure

Status: **built at package level, integration evidence pending** (see
[Evidence](#evidence-measured-timings-and-expiry-proof)). Everything here is
LOCAL SYNTHETIC scope on the isolated `.local/pg18` loopback cluster.
**This local evidence cannot certify managed-host retention, geo-placement,
provider terms or a production RTO** — release requires the actual topology
proof under gate F6 (delivery-checks S13/F5/F6). No readiness claim is made.

## What exists

- `migrations/010-protective-journal.sql` — `app.protective_journal`
  (append-only by trigger, content-free, pinned event shape v1). Applied only
  by `scripts/migrate.ts`. Additive; no existing table changed.
- `src/adapters/protected-journal.ts` — the journal adapter: pinned event
  schemas, in-transaction appends (`journalDeletion`,
  `journalConsentWithdrawal`, `journalSessionRevocation`, fixture-only
  `journalFixtureEvent`), the independent store
  (`.local/protective-journal.jsonl` + `.local/protective-journal-state.json`,
  both 0600, git-ignored), delivery (`deliverPendingJournalEvents`), AD-4
  pruning (`pruneProtectiveJournalFile`, 30-day ceiling), completeness proof
  (`verifyJournalCompleteness`: count + canonical sha256 digest + strictly
  increasing sequence + event shapes; NOT contiguity — a rolled-back append
  burns a `bigserial` value, so gaps are normal), restore-input resolution
  (`resolveJournalInput`, fail-closed), and restore-path replay
  (`replayJournal`, idempotent, deny-only).
- `scripts/backup.ts` (`npm run backup`) — one encrypted PostgreSQL custom
  dump (`pg_dump -Fc` from the `.local/pg18`/`PG_BIN` PostgreSQL 18
  toolchain), one encrypted private-file snapshot (`/usr/bin/tar` over
  `.local/private-objects`), one encrypted full journal export with a recorded
  cut (count + digest taken AFTER the dump completes, so any event committed
  while `pg_dump` ran is inside the export), and a content-free manifest
  `.local/backups/<backupId>.json` (digests, byte counts, schema inventory,
  applied migration inventory, retention expiry). Artifacts are registered in
  `app.retention_registry` under P7's `backup-snapshot` (dump + files) and
  `protective-journal` (journal copy) classes with a 30-day expiry, and each
  run first purges expired snapshots physically (files deleted, rows marked
  purged, manifests removed) — expiry has a working proof path, not just class
  configuration.
- `scripts/restore.ts` (`npm run restore -- <backupId>`) — the ordered
  fail-closed procedure below.
- `tests/integration/restore.test.ts` — scratch-database restore coverage
  including the beyond-criteria case.

## Encryption and key handling

- Cipher: `openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000` (OpenSSL/LibreSSL
  CLI; override with `BACKUP_OPENSSL`). No new npm dependency.
- Key: a single 256-bit hex key in `.local/backup-key` (created `0600`
  exclusive on first backup via `openssl rand -hex 32`). The key lives only
  under `.local/`, is never printed, logged or committed, and is never sent
  anywhere. **Losing `.local/backup-key` makes every snapshot undecryptable by
  design.** For real isolation the key, the snapshot artifacts and the
  independent journal store must be copied to separate storage by the operator
  — a single-machine layout is a convenience, not an isolation guarantee.
- Loopback-only enforcement: backup and restore refuse any non-127.0.0.1
  database URL, mirroring `src/platform/config.ts`.

## Independent protective journal

The database journal table alone cannot survive the disaster it protects
against, so every committed event is also delivered to the independent store
outside PostgreSQL. Delivery is best-effort and idempotent: a failed delivery
is logged (`journal-delivery-pending` in the hook snippets) and the next
backup or delivery re-syncs the tail from the durable table — a delivery
failure never claims success and never loses an event a later backup proves.
The store prunes content-free segments past the 30-day AD-4 ceiling but is
never deleted outright. Restore prefers the independent store (it may contain
post-snapshot events the snapshot predates), requires it to verify against its
own completeness state AND to cover the snapshot's embedded-cut prefix, and
fails closed otherwise; falling back to the snapshot-time copy alone is an
explicit operator decision (`allowEmbeddedJournalFallback`) that leaves
post-snapshot revocations unknown.

## Restore procedure (ordered; every step aborts before later steps run)

1. **Decrypt + verify** dump, files and journal against the manifest digests;
   refuse snapshots older than the 24-hour RPO bound unless
   `allowStaleSnapshot` is explicitly passed.
2. **Prove journal completeness** — before ANY schema is restored. A partial
   or mutated journal aborts the restore with nothing restored at all
   (`tests/integration/restore.test.ts` asserts a tampered backup leaves the
   target database empty).
3. **`pg_restore`** the verified dump into an EMPTY target database (the CLI
   recreates the pinned scratch `tracer_synthetic_restored`; the live database
   is never restored in place).
4. **Ordered schema compatibility** — a scratch reference database is migrated
   by `scripts/migrate.ts` (S1's migration owner; ordered
   auth → application → queue) and every table/column the current code
   requires must exist in the restored schema, else abort.
5. **Invalidate ALL restored sessions** — `auth.session` expiry reset through
   the auth fence trigger (bumping every principal epoch, which also denies
   queued jobs), journaled as one system-scope revocation.
6. **Import + replay the journal** — deletion (re-tombstone roots, invalidate
   objects, cancel operations; purged roots never regress), consent
   withdrawal (re-apply the durable withdrawn decision), session revocation
   (expire listed sessions), fixture types recorded without pretending.
   Replay only denies; it never grants. Still before any traffic, reminders,
   queue dispatch or egress.
7. Private-file snapshot staged back with no-clobber copies; bytes belonging
   to post-snapshot deletions are removed by the standard reconciler at worker
   start (their roots replay to `cleanup_state='pending'` and their reads are
   denied regardless).

**After a successful restore the target is reconciled but NOT live.** The
swap (renaming databases and updating `.local/runtime-config.json`) is a
manual operator step; the worker's startup reconciliation converges pending
physical purges before any traffic can serve them. If any step fails, drop
the target database — a partial restore is never promoted.

## Operator procedure (local, Manual)

1. Stop the web and worker processes (`Ctrl-C`; they hold the loopback
   ports/locks). Backup and restore take a shared advisory lock
   (`pg_advisory_lock 5241003`) and are serialized against each other.
2. `npm run backup` — note the printed `backupId`.
3. Keep `.local/backups/`, `.local/protective-journal.jsonl`,
   `.local/protective-journal-state.json` and `.local/backup-key` safe
   (ideally on separate storage; local layout alone is not isolation).
4. To restore: `npm run restore -- <backupId>`, follow the printed
   content-free events, then perform the manual database swap, delete the old
   independent journal store (the next delivery rebuilds it from the
   restored table), and start web + worker.
5. Verify: sign-in required everywhere (all sessions invalidated), deleted
   studies still denied, withdrawn consent still blocked.

## RPO24h / RTO8h accounting

- **RPO 24h** is the snapshot-frequency bound: a restore may lose up to 24
  hours of changes taken after the newest snapshot. The restore refuses to run
  against a snapshot older than 24h (`restore-stale-snapshot-refused`) unless
  explicitly revalidated — an over-age restore would silently widen the loss
  window. Post-snapshot protective transitions are additionally covered by the
  independent journal delivery, which is why deletion/withdrawal/revocation
  replay is possible at all.
- **RTO 8h** is the procedure budget. `createBackup` and `restoreBackup`
  return per-step millisecond timings and an `rtoBudgetOk` flag (budget
  trivially met locally); the CLI prints them as content-free JSON events.
  Restore duration is dominated by pg_restore and is expected to scale with
  data size — the local measurement says nothing about a production-sized RTO.

## Evidence: measured timings and expiry proof

**Not measured on the package branch.** The package branch never touches
PostgreSQL/openssl (§1.8 of the execution plan: one PG cluster, owned by the
integration workspace). The evidence recorded here is produced at
integration:

- `npm run migrate` applies `010-protective-journal.sql` additively.
- `npm run test:integration` runs `tests/integration/restore.test.ts`
  (synthetic fixtures; creates its own scratch databases): encrypted snapshot
  with registered 30-day inventory, journal delivery failure without false
  success, post-snapshot deletion/withdrawal/revocation journaling, scratch
  restore with pre-reconciliation denial of direct access / dispatch-shaped
  egress / queued work, unrelated owner preserved, tampered-journal fail-closed
  with an empty target, and physical 30-day expiry (files deleted, registry
  purged, repeat purge a no-op). The suite prints the real pg_dump/openssl
  timings.
- One Manual `npm run backup` followed by one Manual
  `npm run restore -- <id>` on the integration workspace records the timed
  operator path (redacted content-free JSON events). Paste those two JSON
  event lines here as the recorded timing evidence:

```
<!-- Integration evidence placeholder — replace with the recorded events:
{"event":"backup-complete",...,"timings":[...]}
{"event":"restore-complete",...,"rtoMinutes":N,"rtoBudgetOk":true,"timings":[...]}
-->
```

- Expiry proof: the retention registry rows for `protective-backup-*` carry
  the 30-day expiry at creation; the integration test backdates them and
  proves the physical purge. Registry receipts themselves expire 30 days after
  their purge (AD-4), handled by P7's scheduler.
- Local evidence cannot certify managed hosting: no managed snapshot
  retention, geo-replication, provider deletion terms or production rehearsal
  is proven here. Those remain S12/F6 requirements; this story must never be
  cited as backup evidence for a deployed system.

## Known limits (honest)

- Single-machine store: `.local/` holds key, artifacts and journal store
  together; true isolation is an operator/managed-topology property.
- The journal database table is append-only and unbounded in row count
  (content-free, tiny); the independent file prunes at 30 days. A future
  story may add table-segment rotation without weakening replay (replay only
  needs events after the newest snapshot).
- `openssl enc` + manifest digests detect corruption and truncation but are
  not a signature scheme: an attacker with write access to `.local/` and the
  key can re-encrypt anything. Local scope accepts this; managed hosting must
  not.
- Session revocation has no live producer endpoint yet (sessions end by
  expiry); the adapter hook exists and the restore-time mass invalidation is
  journaled. Wire `journalSessionRevocation` into any future revocation path.
- Fixture event types (`role-revocation`, `enrollment-revocation`,
  `publication-withdrawal`) have no live modules; replay records them without
  pretending. Consumer epics extend the pinned shape and rerun the contract.

import type { PoolClient } from 'pg';
import {
  lifecycleCategories,
  type ExportCategory,
  type ManifestEntry,
  type SkippedCategory,
} from '../../contracts/export';

// The export snapshot is captured with the caller's single transaction: every
// SELECT below runs on one PoolClient inside one BEGIN/COMMIT window, so a
// concurrent edit either lands entirely before or entirely after the capture.
// File hashes are added later by the builder (storage objects are immutable),
// which keeps the transaction read-only and short.

export type CapturedFile = { objectId: string; key: string; category: 'originals' | 'extractions' };
export type CapturedPayload = { name: string; value: unknown };
export type Capture = {
  capturedAt: string;
  entries: ManifestEntry[];
  files: CapturedFile[];
  payloads: CapturedPayload[];
  objectIds: string[];
  skipped: SkippedCategory[];
};

type ObjectRow = {
  objectId: string;
  rootId: string;
  kind: 'original' | 'extraction' | 'selection' | 'plan';
  parents: string[];
  storageKey: string | null;
  createdAt: Date;
  metadata: unknown;
  textHash: string | null;
  excluded: unknown;
  manifestRevision: number | null;
  plan: unknown;
  extractionId: string | null;
  selectionId: string | null;
  fileName: string | null;
};

function iso(value: Date): string {
  return value.toISOString();
}

async function tableColumns(client: PoolClient, table: string): Promise<Set<string> | null> {
  const found = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name=$1 ORDER BY ordinal_position",
    [table],
  );
  return found.rowCount ? new Set(found.rows.map((item) => item.column_name)) : null;
}

// Pinned derivative tables are enumerated by name and skipped with an honest
// label when the corresponding package has not landed in this deployment.
export async function captureManifest(
  client: PoolClient,
  ownerId: string,
): Promise<Capture> {
  const stamp = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const capturedAt = iso(stamp.rows[0].now);
  const entries: ManifestEntry[] = [];
  const files: CapturedFile[] = [];
  const payloads: CapturedPayload[] = [];
  const skipped: SkippedCategory[] = [];

  const objects = await client.query<ObjectRow>(
    `SELECT o.id AS "objectId", o.root_id AS "rootId", o.kind, o.parent_ids AS parents, o.storage_key AS "storageKey",
      o.created_at AS "createdAt", e.metadata, e.text_hash AS "textHash",
      sr.excluded, sr.manifest_revision AS "manifestRevision",
      p.plan, p.extraction_id AS "extractionId", p.selection_id AS "selectionId",
      COALESCE(m.filename, s.filename) AS "fileName"
     FROM app.lifecycle_object o
     JOIN app.lifecycle_root r ON r.id = o.root_id
     LEFT JOIN app.extraction_revision e ON e.id = o.id
     LEFT JOIN app.selection_revision sr ON sr.id = o.id
     LEFT JOIN app.plan_revision p ON p.id = o.id
     LEFT JOIN app.material m ON m.id = o.root_id
     LEFT JOIN app.batch_slot s ON s.root_id = o.root_id
     WHERE r.owner_id=$1 AND r.deleted_at IS NULL AND o.invalidated_at IS NULL
       AND o.kind IN ('original','extraction','selection','plan')
     ORDER BY o.created_at, o.id`,
    [ownerId],
  );
  for (const item of objects.rows) {
    const base = {
      objectId: item.objectId,
      rootId: item.rootId,
      storageKey: item.storageKey,
      parents: item.parents ?? [],
      createdAt: iso(item.createdAt),
    };
    if (item.kind === 'original') {
      entries.push({ category: 'originals', fileName: item.fileName ?? undefined, ...base });
      if (item.storageKey) files.push({ objectId: item.objectId, key: item.storageKey, category: 'originals' });
    } else if (item.kind === 'extraction') {
      entries.push({ category: 'extractions', metadata: { metadata: item.metadata, textHash: item.textHash }, ...base });
      if (item.storageKey) files.push({ objectId: item.objectId, key: item.storageKey, category: 'extractions' });
    } else if (item.kind === 'selection') {
      entries.push({ category: 'selections', metadata: { manifestRevision: item.manifestRevision }, ...base });
      payloads.push({ name: `selections/${item.objectId}.json`, value: { excluded: item.excluded, manifestRevision: item.manifestRevision } });
    } else {
      entries.push({ category: 'plans', metadata: { extractionId: item.extractionId, selectionId: item.selectionId }, ...base });
      payloads.push({ name: `plans/${item.objectId}.json`, value: { plan: item.plan, extractionId: item.extractionId, selectionId: item.selectionId } });
    }
  }

  const confirmations = await client.query<{ planId: string; rootId: string; confirmedAt: Date }>(
    `SELECT pc.plan_id AS "planId", pc.root_id AS "rootId", pc.confirmed_at AS "confirmedAt"
     FROM app.plan_confirmation pc
     JOIN app.lifecycle_object lo ON lo.id = pc.plan_id
     JOIN app.lifecycle_root r ON r.id = lo.root_id
     WHERE r.owner_id=$1 AND lo.invalidated_at IS NULL AND r.deleted_at IS NULL
     ORDER BY pc.confirmed_at, pc.plan_id`,
    [ownerId],
  );
  for (const item of confirmations.rows) {
    entries.push({
      category: 'confirmations',
      objectId: item.planId,
      rootId: item.rootId,
      storageKey: null,
      parents: [item.planId],
      createdAt: iso(item.confirmedAt),
      metadata: { confirmedAt: iso(item.confirmedAt) },
    });
    payloads.push({ name: `confirmations/${item.planId}.json`, value: { rootId: item.rootId, confirmedAt: iso(item.confirmedAt) } });
  }

  await captureReceiptTable(client, ownerId, 'processing_decision', 'processing-decisions', 'processing/processing-decisions.json', { entries, payloads, skipped });
  await captureReceiptTable(client, ownerId, 'dispatch_admission', 'dispatch-admissions', 'processing/dispatch-admissions.json', { entries, payloads, skipped });
  await captureDiagnostics(client, ownerId, { entries, payloads, skipped });
  // Epic-2 S8 export scope decision (this entry's recorded call): generated
  // courses, practice evidence and why explanations are OWNER derivative
  // content and join the artifact honestly. The stored course content
  // includes every recall answer because the owner can already reveal any of
  // them by submitting (the diagnostic answer-key exclusion never applied to
  // owner-specific courses); practice evidence carries the learner's own
  // attempted text; why explanations are the owner's settled derivative rows.
  await captureCourseDerivatives(client, ownerId, { entries, payloads, skipped });
  // Epic-3 3.9 export scope decision (this entry's recorded call, the S8
  // pattern applied to assessment): attempts with their at-start snapshots,
  // the recovery ledger and retest chain, completion awards, item flags,
  // dispute states, corrected replacements and the studied-release pointer
  // are OWNER derivative content and join the artifact honestly. Snapshots
  // include answer keys by the same S8 reasoning — the owner can already
  // reveal any answer by submitting, so no assessment exclusion is invented.
  await captureAssessmentDerivatives(client, ownerId, { entries, payloads, skipped });
  // S6: advisory AI draft requests are deliberately excluded from the artifact
  // (the simpler honest option per the S6 plan): they are suggestions the
  // learner edits, not canonical owner content, and no source excerpt or
  // provider reply belongs in an export. The skip line records the exclusion.
  if (await tableColumns(client, 'ai_draft_request')) {
    skipped.push({
      category: 'ai-drafts',
      reason:
        'Deliberately excluded: advisory AI draft requests (topics/plan suggestions the learner edits before any save) and their provider replies are not exported; the accepted plan the learner actually confirmed is exported under plans',
    });
  } else {
    skipped.push({ category: 'ai-drafts', reason: 'Table app.ai_draft_request is not present in this deployment' });
  }
  // Epic-2 S8: fetched supplement passages stay a deliberate, honestly-
  // reasoned skip — they are external-source content, not owner material, and
  // neither the fetched passage nor the upload excerpt it may conflict with
  // belongs in the owner's artifact. Their identity/location metadata (source,
  // locator, content hash, retrieval time) rides along inside each exported
  // course's provenance context, so the skip loses nothing the owner owned.
  if (await tableColumns(client, 'course_supplement')) {
    skipped.push({
      category: 'supplements',
      reason:
        'Deliberately excluded: fetched supplement passages are external-source content, not owner material — passages and conflict excerpts stay out of the artifact, while their identity/location metadata (source, locator, content hash, retrieval time) rides along inside each exported course\u2019s provenance context',
    });
  } else {
    skipped.push({ category: 'supplements', reason: 'Table app.course_supplement is not present in this deployment' });
  }
  // Epic-3 3.9: the content-free daily generation counter is the one
  // assessment skip — deliberately excluded (the ASSESSMENT_GENERATION_USE_SKIP
  // reason records why and where the counted evidence ships).
  if (await tableColumns(client, 'assessment_generation_use')) {
    skipped.push({ category: 'assessment-generation-use', reason: ASSESSMENT_GENERATION_USE_SKIP });
  } else {
    skipped.push({ category: 'assessment-generation-use', reason: 'Table app.assessment_generation_use is not present in this deployment' });
  }

  return {
    capturedAt,
    entries,
    files,
    payloads,
    objectIds: entries.filter((entry) => (lifecycleCategories as readonly string[]).includes(entry.category)).map((entry) => entry.objectId),
    skipped,
  };
}

type CaptureSink = { entries: ManifestEntry[]; payloads: CapturedPayload[]; skipped: SkippedCategory[] };

async function captureReceiptTable(
  client: PoolClient,
  ownerId: string,
  table: 'processing_decision' | 'dispatch_admission',
  category: ExportCategory,
  payloadName: string,
  sink: CaptureSink,
) {
  const columns = await tableColumns(client, table);
  if (!columns) {
    sink.skipped.push({ category, reason: `Table app.${table} is not present in this deployment` });
    return;
  }
  if (!columns.has('owner_id')) {
    sink.skipped.push({ category, reason: `Table app.${table} has no owner column; this export version cannot inventory it` });
    return;
  }
  const rows = await client.query<Record<string, unknown>>(
    `SELECT * FROM app.${table} WHERE owner_id=$1 ORDER BY 1 LIMIT 10000`,
    [ownerId],
  );
  for (const [index, item] of rows.rows.entries()) {
    sink.entries.push({
      category,
      objectId: typeof item.command_key === 'string' ? item.command_key : typeof item.id === 'string' ? item.id : `row-${index}`,
      rootId: typeof item.root_id === 'string' ? item.root_id : null,
      storageKey: null,
      parents: [],
      createdAt: item.created_at instanceof Date ? iso(item.created_at) : new Date(0).toISOString(),
      metadata: item,
    });
  }
  sink.payloads.push({ name: payloadName, value: { table: `app.${table}`, rows: rows.rows } });
}

const diagnosticTables = [
  { table: 'diagnostic_bundle', payload: 'diagnostics/diagnostic-bundles.json' },
  { table: 'diagnostic_item', payload: 'diagnostics/diagnostic-items.json' },
  { table: 'diagnostic_evidence', payload: 'diagnostics/diagnostic-evidence.json' },
] as const;

// The epic-2 S8 owner-derivative classes. Every query below is snapshot-scoped
// exactly like the lifecycle classes above: rows of deleted roots are excluded
// by the root tombstone, and a ready course whose own lifecycle object was
// invalidated is excluded the same way invalidated objects are.
type CourseRow = {
  id: string;
  root_id: string;
  plan_revision_id: string;
  selection_id: string;
  admission_id: string;
  object_id: string | null;
  status: string;
  failure_code: string | null;
  version: number | null;
  superseded_by: string | null;
  content: unknown;
  model: string | null;
  usage: unknown;
  preference_pin: unknown;
  created_at: Date;
  settled_at: Date | null;
};
type PracticeRow = {
  id: string;
  course_id: string;
  root_id: string;
  card_id: string;
  attempted: string;
  outcome: string;
  evidence_kind: string;
  submitted_at: Date;
};
type WhyRow = {
  id: string;
  course_id: string;
  root_id: string;
  lesson_index: number;
  depth: number;
  status: string;
  failure_code: string | null;
  dimension: string | null;
  explanation: string | null;
  sources: unknown;
  model: string | null;
  created_at: Date;
  settled_at: Date | null;
};

async function supplementReferenceRows(client: PoolClient, ownerId: string, courseId: string) {
  // Identity/location metadata ONLY (the S7 provenance derivative shape):
  // never the fetched passage, never the upload excerpt, never the claim.
  const rows = await client.query<Record<string, unknown>>(
    `WITH latest AS (
       SELECT id, status FROM app.supplement_request
       WHERE course_id=$1 AND owner_id=$2 ORDER BY created_at DESC, id DESC LIMIT 1
     )
     SELECT s.position, s.outcome, s.url, s.origin, s.locator, s.content_hash AS "contentHash", s.retrieved_at AS "retrievedAt"
     FROM app.course_supplement s JOIN latest l ON l.id=s.request_id AND l.status='ready'
     WHERE s.course_id=$1 ORDER BY s.position`,
    [courseId, ownerId],
  );
  return rows.rows;
}

async function captureCourseDerivatives(client: PoolClient, ownerId: string, sink: CaptureSink) {
  // generated-courses: full stored rows (content included — recall answers are
  // owner derivative content per the recorded S8 decision) plus the course's
  // lineage and provenance context.
  if (await tableColumns(client, 'generated_course')) {
    const courses = await client.query<CourseRow>(
      `SELECT c.id, c.root_id, c.plan_revision_id, c.selection_id, c.admission_id, c.object_id,
         c.status, c.failure_code, c.version, c.superseded_by, c.content, c.model, c.usage,
         c.preference_pin, c.created_at, c.settled_at
       FROM app.generated_course c
       JOIN app.lifecycle_root r ON r.id=c.root_id
       LEFT JOIN app.lifecycle_object o ON o.id=c.object_id
       WHERE c.owner_id=$1 AND r.deleted_at IS NULL
         AND (c.object_id IS NULL OR o.invalidated_at IS NULL)
       ORDER BY c.created_at, c.id`,
      [ownerId],
    );
    for (const course of courses.rows) {
      sink.entries.push({
        category: 'generated-courses',
        objectId: course.id,
        rootId: course.root_id,
        storageKey: null,
        parents: [course.object_id ?? course.plan_revision_id],
        createdAt: iso(course.created_at),
        metadata: { status: course.status, version: course.version, failureCode: course.failure_code, model: course.model },
      });
      const objectives = (
        await client.query<{ position: number; objective: string }>(
          'SELECT position,objective FROM app.course_objective WHERE course_id=$1 ORDER BY position',
          [course.id],
        )
      ).rows;
      const sources = (
        await client.query<{ position: number; extraction_id: string; filename: string }>(
          'SELECT position,extraction_id,filename FROM app.course_source WHERE course_id=$1 ORDER BY position',
          [course.id],
        )
      ).rows;
      const payload = {
        table: 'app.generated_course',
        row: {
          ...course,
          created_at: iso(course.created_at),
          settled_at: course.settled_at ? iso(course.settled_at) : null,
        },
        objectives,
        sources,
        supplementReferences: await supplementReferenceRows(client, ownerId, course.id),
      };
      sink.payloads.push({ name: `courses/${course.id}.json`, value: payload });
    }
  } else {
    sink.skipped.push({ category: 'generated-courses', reason: 'Table app.generated_course is not present in this deployment' });
  }
  // practice-evidence: the typed submission rows, attempted text included —
  // owner content per the recorded S8 decision.
  if (await tableColumns(client, 'practice_attempt')) {
    const practice = await client.query<PracticeRow>(
      `SELECT p.id, p.course_id, c.root_id, p.card_id, p.attempted, p.outcome, p.evidence_kind, p.submitted_at
       FROM app.practice_attempt p
       JOIN app.generated_course c ON c.id=p.course_id
       JOIN app.lifecycle_root r ON r.id=c.root_id
       LEFT JOIN app.lifecycle_object o ON o.id=c.object_id
       WHERE p.owner_id=$1 AND r.deleted_at IS NULL AND (c.object_id IS NULL OR o.invalidated_at IS NULL)
       ORDER BY p.submitted_at, p.id`,
      [ownerId],
    );
    for (const item of practice.rows) {
      sink.entries.push({
        category: 'practice-evidence',
        objectId: item.id,
        rootId: item.root_id,
        storageKey: null,
        parents: [item.course_id],
        createdAt: iso(item.submitted_at),
        metadata: { cardId: item.card_id, outcome: item.outcome, evidenceKind: item.evidence_kind },
      });
    }
    sink.payloads.push({
      name: 'practice/practice-evidence.json',
      value: { table: 'app.practice_attempt', rows: practice.rows.map(item => ({ ...item, submitted_at: iso(item.submitted_at) })) },
    });
  } else {
    sink.skipped.push({ category: 'practice-evidence', reason: 'Table app.practice_attempt is not present in this deployment' });
  }
  // why-explanations: the settled explanation rows — owner derivative content
  // per the recorded S8 decision.
  if (await tableColumns(client, 'why_explanation')) {
    const why = await client.query<WhyRow>(
      `SELECT w.id, w.course_id, w.root_id, w.lesson_index, w.depth, w.status, w.failure_code,
         w.dimension, w.explanation, w.sources, w.model, w.created_at, w.settled_at
       FROM app.why_explanation w
       JOIN app.generated_course c ON c.id=w.course_id
       JOIN app.lifecycle_root r ON r.id=w.root_id
       LEFT JOIN app.lifecycle_object o ON o.id=c.object_id
       WHERE w.owner_id=$1 AND r.deleted_at IS NULL AND (c.object_id IS NULL OR o.invalidated_at IS NULL)
       ORDER BY w.created_at, w.id`,
      [ownerId],
    );
    for (const item of why.rows) {
      sink.entries.push({
        category: 'why-explanations',
        objectId: item.id,
        rootId: item.root_id,
        storageKey: null,
        parents: [item.course_id],
        createdAt: iso(item.created_at),
        metadata: { lessonIndex: item.lesson_index, depth: item.depth, status: item.status, dimension: item.dimension, model: item.model },
      });
    }
    sink.payloads.push({
      name: 'why/why-explanations.json',
      value: {
        table: 'app.why_explanation',
        rows: why.rows.map(item => ({ ...item, created_at: iso(item.created_at), settled_at: item.settled_at ? iso(item.settled_at) : null })),
      },
    });
  } else {
    sink.skipped.push({ category: 'why-explanations', reason: 'Table app.why_explanation is not present in this deployment' });
  }
}

async function captureDiagnostics(client: PoolClient, ownerId: string, sink: CaptureSink) {
  const bundleColumns = await tableColumns(client, 'diagnostic_bundle');
  const bundleOwned = !!bundleColumns?.has('owner_id');
  const bundleIds = bundleOwned
    ? (await client.query<{ id: string }>('SELECT id FROM app.diagnostic_bundle WHERE owner_id=$1 ORDER BY 1 LIMIT 10000', [ownerId])).rows.map((item) => item.id)
    : [];
  for (const part of diagnosticTables) {
    const category: ExportCategory = 'diagnostic-evidence';
    const columns = await tableColumns(client, part.table);
    if (!columns) {
      sink.skipped.push({ category, reason: `Table app.${part.table} is not present in this deployment` });
      continue;
    }
    let rows: Record<string, unknown>[];
    if (columns.has('owner_id')) {
      rows = (await client.query<Record<string, unknown>>(`SELECT * FROM app.${part.table} WHERE owner_id=$1 ORDER BY 1 LIMIT 10000`, [ownerId])).rows;
    } else if (part.table !== 'diagnostic_bundle' && columns.has('bundle_id') && bundleIds.length) {
      rows = (await client.query<Record<string, unknown>>(`SELECT * FROM app.${part.table} WHERE bundle_id=ANY($1::uuid[]) ORDER BY 1 LIMIT 10000`, [bundleIds])).rows;
    } else {
      // The item-bank tables (answer ids, rationales, the bank itself) are not
      // owner content; owners receive their diagnostic evidence, not the key.
      sink.skipped.push({ category, reason: `Deliberately excluded: app.${part.table} holds the diagnostic item bank (answer keys and rationales), which is not owner content; owner diagnostic evidence is exported separately` });
      continue;
    }
    for (const [index, item] of rows.entries()) {
      sink.entries.push({
        category,
        objectId: typeof item.id === 'string' ? item.id : `row-${index}`,
        rootId: typeof item.root_id === 'string' ? item.root_id : null,
        storageKey: null,
        parents: typeof item.bundle_id === 'string' ? [item.bundle_id] : [],
        createdAt: item.created_at instanceof Date ? iso(item.created_at) : new Date(0).toISOString(),
        metadata: item,
      });
    }
    sink.payloads.push({ name: part.payload, value: { table: `app.${part.table}`, rows } });
  }
}

// The epic-3 3.9 deliberate-exclusion reason for the content-free daily
// generation counter (the ai_dispatch_ledger precedent): it is owner
// accounting, not study content, and shipping it would add nothing the
// owner's exported attempt/retest/replacement history does not already
// carry.
export const ASSESSMENT_GENERATION_USE_SKIP =
  'Deliberately excluded: the daily assessment generation counter is a content-free resource accounting row (how many fresh retests/replacements started today), not study content; the attempts, retests and replacements it counted are exported under assessment-evidence';

// jsonb round-trips Date objects as ISO strings only if mapped first — the
// assessment payloads carry timestamps at the row top level, so every row
// passes through this pure mapping before it joins a payload.
export function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

// The snapshot-scope guard shared by every assessment query below, exactly
// the epic-2 S8 hardened shape: rows of tombstoned roots are excluded, and
// course-linked rows are excluded when their course's own lifecycle object
// was invalidated. Assessment tables carry no storage keys — entries are
// content-free locators plus the payload rows themselves.
async function captureAssessmentDerivatives(client: PoolClient, ownerId: string, sink: CaptureSink) {
  type Row = Record<string, unknown> & { id: string; root_id: string; course_id?: string | null };

  const captureTable = async (
    table: string,
    payloadName: string,
    courseJoin: string,
    guard: string,
    stampColumn: string,
    metaOf: (row: Row) => unknown,
  ) => {
    if (!(await tableColumns(client, table))) {
      sink.skipped.push({ category: 'assessment-evidence', reason: `Table app.${table} is not present in this deployment` });
      return;
    }
    const rows = await client.query<Row>(
      `SELECT t.* FROM app.${table} t
       JOIN app.lifecycle_root r ON r.id = t.root_id
       ${courseJoin}
       WHERE t.owner_id=$1 AND r.deleted_at IS NULL ${guard}
       ORDER BY t.${stampColumn}, t.id`,
      [ownerId],
    );
    for (const item of rows.rows) {
      const stamp = item[stampColumn];
      sink.entries.push({
        category: 'assessment-evidence',
        objectId: item.id,
        rootId: item.root_id,
        storageKey: null,
        parents: item.course_id ? [item.course_id] : [],
        createdAt: stamp instanceof Date ? iso(stamp) : new Date(0).toISOString(),
        metadata: metaOf(item),
      });
    }
    sink.payloads.push({ name: payloadName, value: { table: `app.${table}`, rows: rows.rows.map(row => jsonSafe(row)) } });
  };

  // Every course-linked table uses the same invalidation guard the epic-2
  // practice/why queries carry; the award query's guard also admits the
  // parent-path rows whose course linkage is NULL (they ride the root
  // tombstone alone), and the flag query joins its attempt's course because
  // the flag row itself carries no course column.
  const courseJoin = 'JOIN app.generated_course c ON c.id = t.course_id LEFT JOIN app.lifecycle_object o ON o.id = c.object_id';
  const courseGuard = 'AND (c.object_id IS NULL OR o.invalidated_at IS NULL)';
  const nullableCourseGuard = 'AND (c.id IS NULL OR c.object_id IS NULL OR o.invalidated_at IS NULL)';

  await captureTable('test_attempt', 'assessments/attempts.json', courseJoin, courseGuard, 'created_at',
    row => ({ status: row.status, courseVersion: row.course_version, passed: row.passed, earnedPoints: row.earned_points, totalPoints: row.total_points }));
  await captureTable('retest_attempt', 'assessments/retests.json', courseJoin, courseGuard, 'created_at',
    row => ({ status: row.status, courseVersion: row.course_version, targetIndexes: row.target_objective_indexes }));
  await captureTable('recovery_target', 'assessments/recovery-ledger.json', courseJoin, courseGuard, 'created_at',
    row => ({ objectiveIndex: row.objective_index, status: row.status, clearedBy: row.cleared_by }));
  await captureTable('completion_award', 'assessments/awards.json',
    'LEFT JOIN app.generated_course c ON c.id = t.course_id LEFT JOIN app.lifecycle_object o ON o.id = c.object_id', nullableCourseGuard, 'created_at',
    row => ({ kind: row.kind, courseVersion: row.course_version, awardedAt: row.awarded_at instanceof Date ? iso(row.awarded_at) : null }));
  await captureTable('assessment_flag', 'assessments/flags.json',
    'JOIN app.test_attempt a ON a.id = t.attempt_id JOIN app.generated_course c ON c.id = a.course_id LEFT JOIN app.lifecycle_object o ON o.id = c.object_id',
    courseGuard, 'flagged_at',
    row => ({ position: row.position, evidenceKind: row.retest_id ? 'retest' : 'attempt' }));
  await captureTable('item_dispute', 'assessments/disputes.json', courseJoin, courseGuard, 'opened_at',
    row => ({ status: row.status, objectiveIndex: row.objective_index, position: row.position, courseVersion: row.course_version }));
  await captureTable('assessment_replacement', 'assessments/replacements.json', courseJoin, courseGuard, 'created_at',
    row => ({ status: row.status, objectiveIndex: row.objective_index, courseVersion: row.course_version }));
  await captureTable('studied_release', 'assessments/release-pointers.json', courseJoin, courseGuard, 'switched_at',
    row => ({ courseId: row.course_id }));
}

// Owner-scoped active counts for the pre-request category preview.
export async function activeCounts(client: PoolClient, ownerId: string) {
  const objects = await client.query<{ kind: string; count: number }>(
    `SELECT o.kind, count(*)::int AS count FROM app.lifecycle_object o
     JOIN app.lifecycle_root r ON r.id=o.root_id
     WHERE r.owner_id=$1 AND r.deleted_at IS NULL AND o.invalidated_at IS NULL
       AND o.kind IN ('original','extraction','selection','plan') GROUP BY o.kind`,
    [ownerId],
  );
  const confirmations = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM app.plan_confirmation pc
     JOIN app.lifecycle_object lo ON lo.id = pc.plan_id
     JOIN app.lifecycle_root r ON r.id = lo.root_id
     WHERE r.owner_id=$1 AND lo.invalidated_at IS NULL AND r.deleted_at IS NULL`,
    [ownerId],
  );
  // Epic-2 S8 flipped classes: live counts use the same snapshot scope as the
  // capture itself (deleted roots excluded; invalidated course objects out).
  // Absent tables report no count (null in the preview) exactly like the
  // capture's own absence guards.
  const courses = (await tableColumns(client, 'generated_course'))
    ? await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM app.generated_course c
         JOIN app.lifecycle_root r ON r.id=c.root_id
         LEFT JOIN app.lifecycle_object o ON o.id=c.object_id
         WHERE c.owner_id=$1 AND r.deleted_at IS NULL AND (c.object_id IS NULL OR o.invalidated_at IS NULL)`,
        [ownerId],
      )
    : null;
  const practice = (await tableColumns(client, 'practice_attempt'))
    ? await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM app.practice_attempt p
         JOIN app.generated_course c ON c.id=p.course_id
         JOIN app.lifecycle_root r ON r.id=c.root_id
         WHERE p.owner_id=$1 AND r.deleted_at IS NULL`,
        [ownerId],
      )
    : null;
  const why = (await tableColumns(client, 'why_explanation'))
    ? await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM app.why_explanation w
         JOIN app.lifecycle_root r ON r.id=w.root_id
         WHERE w.owner_id=$1 AND r.deleted_at IS NULL`,
        [ownerId],
      )
    : null;
  const byKind = new Map(objects.rows.map((item) => [item.kind, item.count]));
  // Epic-3 3.9: the assessment class carries live owner counts under the
  // same snapshot scope as its capture (deleted roots excluded, invalidated
  // course objects out) — the epic-2 S8 flipped-class pattern.
  const assessment = (await tableColumns(client, 'test_attempt'))
    ? await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM app.test_attempt t
         JOIN app.lifecycle_root r ON r.id=t.root_id
         JOIN app.generated_course c ON c.id=t.course_id
         LEFT JOIN app.lifecycle_object o ON o.id=c.object_id
         WHERE t.owner_id=$1 AND r.deleted_at IS NULL AND (c.object_id IS NULL OR o.invalidated_at IS NULL)`,
        [ownerId],
      )
    : null;
  return {
    originals: byKind.get('original') ?? 0,
    extractions: byKind.get('extraction') ?? 0,
    selections: byKind.get('selection') ?? 0,
    plans: byKind.get('plan') ?? 0,
    confirmations: confirmations.rows[0]?.count ?? 0,
    courses: courses?.rows[0]?.count ?? null,
    practice: practice?.rows[0]?.count ?? null,
    why: why?.rows[0]?.count ?? null,
    assessmentAttempts: assessment?.rows[0]?.count ?? null,
  };
}

export async function tablePresent(client: PoolClient, table: string): Promise<boolean> {
  return !!(await tableColumns(client, table));
}

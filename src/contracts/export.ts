import { z } from 'zod';
import { commandSchema, uuid } from './setup';

export const exportStates = ['queued', 'running', 'ready', 'failed', 'expired', 'canceled'] as const;
export type ExportState = typeof exportStates[number];
// Single source of truth for the durable export queue: migrate.ts creates it,
// the worker consumes it.
export const EXPORT_QUEUE = 'export-setup-v1';
export const exportReasons = ['resource', 'service'] as const;
export type ExportReason = typeof exportReasons[number];
export const exportCategories = [
  'originals',
  'extractions',
  'selections',
  'plans',
  'confirmations',
  'processing-decisions',
  'dispatch-admissions',
  'diagnostic-evidence',
  'ai-drafts',
  'generated-courses',
  'supplements',
  'practice-evidence',
  'why-explanations',
  'assessment-evidence',
  'assessment-generation-use',
] as const;
export type ExportCategory = typeof exportCategories[number];
export const exportCategoryLabels: Record<ExportCategory, string> = {
  originals: 'Original materials',
  extractions: 'Extraction revisions',
  selections: 'Acknowledged source sets',
  plans: 'Plan revisions',
  confirmations: 'Plan confirmations',
  'processing-decisions': 'Processing decisions',
  'dispatch-admissions': 'Dispatch admissions',
  'diagnostic-evidence': 'Diagnostic evidence',
  'ai-drafts': 'AI draft requests (advisory)',
  'generated-courses': 'Generated mini-courses',
  supplements: 'Verified source supplements',
  'practice-evidence': 'Practice evidence',
  'why-explanations': 'AI why explanations',
  'assessment-evidence': 'Scored assessment history (attempts, recovery, awards, disputes)',
  'assessment-generation-use': 'Assessment generation counters (content-free)',
};
// Categories whose entries are lifecycle objects; only these may appear in the
// artifact object's parent_ids so the recursive fences cover the export.
export const lifecycleCategories = ['originals', 'extractions', 'selections', 'plans'] as const satisfies readonly ExportCategory[];
// Maximum artifact lifetime. The migration and worker never exceed 24 hours.
export const EXPORT_TTL_HOURS = 24;
// Local synthetic bound; an export exceeding it fails honestly with reason
// 'resource' instead of truncating. No broader deployment claim is attached.
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
// A duplicate click reuses the pending key; one artifact per command.
export const exportRequestSchema = commandSchema.refine(
  (value) => value.expectedRevision === 0,
  { message: 'Exports are owner-scoped and use expectedRevision 0.' },
);
export const exportJobSchema = z.strictObject({ schemaVersion: z.literal(1), requestId: uuid });
export type ExportCommand = z.infer<typeof exportRequestSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
// jsonb does not preserve object key order, so the manifest hash is taken over
// a canonical form with recursively sorted keys; the hash is stable across a
// database round-trip and across capture/commit boundaries.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export type ManifestEntry = {
  category: ExportCategory;
  objectId: string;
  rootId: string | null;
  storageKey: string | null;
  parents: string[];
  createdAt: string;
  fileName?: string;
  sha256?: string;
  bytes?: number;
  metadata?: unknown;
};
export type SkippedCategory = { category: ExportCategory; reason: string };
export type Manifest = {
  schemaVersion: 1;
  requestId: string;
  ownerId: string;
  capturedAt: string;
  manifestHash: string;
  entries: ManifestEntry[];
  skipped: SkippedCategory[];
};
export type ExportCategoryInfo = { category: ExportCategory; label: string; count: number | null; available: boolean; note?: string };
export type ExportSummary = {
  id: string;
  state: ExportState;
  createdAt: string;
  expiresAt: string | null;
  bytes: number | null;
  manifestHash: string | null;
  reason: ExportReason | null;
};
export type ExportPreview = { categories: ExportCategoryInfo[]; requests: ExportSummary[] };

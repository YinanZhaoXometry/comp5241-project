export const messages = {
  UNAUTHENTICATED: 'Sign in again to continue.',
  FORBIDDEN_OR_NOT_FOUND: 'This item is unavailable.',
  INVALID_INPUT:
    'Check the input. Only non-empty text-based PDF, DOCX, TXT or Markdown files up to 20 MiB each (ten per batch) are supported.',
  CONFLICT:
    'The saved revision changed. Reload the latest version before reapplying your edits.',
  RATE_LIMITED: 'The local processing limit has been reached. Try again later.',
  AI_BUDGET_EXHAUSTED:
    'The local AI budget is exhausted. No request was dispatched; the operator must review the ledger before more.',
  RETRYABLE_FAILURE:
    'The operation could not finish. Saved work is unchanged; retry when available.',
} as const;
export type ErrorCode = keyof typeof messages;
export function fail(code: ErrorCode): never {
  throw Object.assign(new Error(messages[code]), { code });
}
export function errorCode(error: unknown): ErrorCode {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code in messages
    ? (error.code as ErrorCode)
    : 'RETRYABLE_FAILURE';
}

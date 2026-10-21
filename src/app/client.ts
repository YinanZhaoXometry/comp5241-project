import { messages, type ErrorCode } from "../platform/errors";
import type { Command } from "../contracts/setup";

export function command(expectedRevision = 0): Command { return { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision }; }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { ...options, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    let code: ErrorCode = "RETRYABLE_FAILURE";
    try { const body = await response.json(); if (body.error?.code in messages) code = body.error.code; } catch { /* Safe fallback; never surface raw responses. */ }
    throw Object.assign(new Error(messages[code]), { code });
  }
  return response.json() as Promise<T>;
}
export function json(value: unknown): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }; }
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { fail } from "./errors";

// Shared command-envelope helpers, consolidated by the S11 refactor sweep.
// Wave packages each carried local copies so parallel branches could not break
// each other (see the deferral note that stood in setup-preferences); the
// implementations below are byte-for-byte the behavior those copies had.
export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function parse<T>(parser: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return parser.parse(value);
  } catch (error) {
    if (error instanceof ZodError) fail("INVALID_INPUT");
    throw error;
  }
}

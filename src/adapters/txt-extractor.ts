import { execFile } from "node:child_process";
import { MAX_BYTES, validateText } from "../contracts/setup";
import { config } from "../platform/config";

export async function extractTxt(input: string): Promise<string> {
  const result = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile(config().extractorPath, [], { env: { NODE_ENV: "production" }, timeout: 10000, killSignal: "SIGKILL", maxBuffer: MAX_BYTES, encoding: "buffer" }, (error, stdout) => {
      if (error) reject(new Error("Bounded TXT extraction failed")); else resolve(stdout);
    });
    child.stdin!.on("error", () => { /* execFile reports early exit; never log input. */ });
    child.stdin!.end(input);
  });
  const text = validateText(result);
  if (text !== input) throw new Error("TXT extraction integrity failure");
  return text;
}
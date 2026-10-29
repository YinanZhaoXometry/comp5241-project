import { readFile } from "node:fs/promises";
import { StudyApp } from "./study-app";

export const dynamic = "force-dynamic";

type SyntheticActor = { label: string; email: string; password?: string };

// Prefill the sign-in form with the local synthetic learner account's email
// AND password. The credentials file is generated locally by `npm run
// provision`, is ignored by git and never committed; when it is absent the
// form simply starts empty. Owner direction 2026-10-29 restored the password
// prefill (the 2026-10-24 email-only remediation made sign-in unusable for
// the operator, who had no way to learn the random provisioned password);
// this is a deliberate owner-accepted deviation recorded in
// plan-visual-spine-revision.md §12 — never extend it beyond .local synthetic
// accounts or non-local serving.
async function localLearnerAccount(): Promise<SyntheticActor | null> {
  try {
    const actors = JSON.parse(await readFile(".local/synthetic-credentials.json", "utf8")) as SyntheticActor[];
    const learner = actors.find(actor => actor.label === "A");
    return learner && typeof learner.email === "string" && typeof learner.password === "string" ? learner : null;
  } catch {
    return null;
  }
}

export default async function Page() {
  const account = await localLearnerAccount();
  return <StudyApp prefillEmail={account?.email} prefillPassword={account?.password} />;
}

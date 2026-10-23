import { readFile } from "node:fs/promises";
import { StudyApp } from "./study-app";

export const dynamic = "force-dynamic";

type SyntheticActor = { label: string; email: string; password: string };

// Prefill the sign-in form with the local synthetic learner account. The
// credentials file is generated locally by `npm run provision`, is ignored by
// git and never committed; when it is absent the form simply starts empty.
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

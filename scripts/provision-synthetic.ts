import { writeFile } from "node:fs/promises";
import { provisionSynthetic } from "../src/modules/identity-access/provision";
import { closeDatabase } from "../src/adapters/postgres/database";

try {
  const actors = [];
  for (const [label, role] of [["A", "learner"], ["B", "learner"], ["instructor", "instructor"], ["admin", "admin"]] as const) actors.push(await provisionSynthetic(label, role));
  await writeFile(".local/synthetic-credentials.json", JSON.stringify(actors, null, 2), { mode: 0o600, flag: "wx" });
  console.log("Four synthetic actors provisioned through Better Auth. Credentials saved privately; open the ignored local credential file in the editor, never paste it into chat.");
} finally { await closeDatabase(); }
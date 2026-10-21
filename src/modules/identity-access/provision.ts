import { randomBytes } from "node:crypto";
import { database } from "../../adapters/postgres/database";
import { createAuth } from "./auth";

export async function provisionSynthetic(label: string, role: "learner" | "instructor" | "admin") {
  const email = `${label}-${crypto.randomUUID()}@synthetic.invalid`;
  const password = randomBytes(32).toString("base64url");
  const result = await createAuth(database(), true).api.signUpEmail({ body: { email, password, name: `Synthetic ${label}` } });
  await database().query("INSERT INTO app.identity_principal(user_id,role) VALUES($1,$2)", [result.user.id, role]);
  return { email, password, userId: result.user.id, label, role };
}
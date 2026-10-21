import type { PoolClient } from "pg";
import type { Identity } from "../../contracts/setup";
import { fail } from "../../platform/errors";
import { auth } from "./auth";

export async function identify(headers: Headers): Promise<Identity> {
  const session = await auth().api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session) fail("UNAUTHENTICATED");
  return { userId: session.user.id, sessionId: session.session.id };
}
export async function authorize(client: PoolClient, identity: Identity, epoch?: number) {
  // The same row is locked by the auth-session revocation trigger.
  const principal = await client.query<{ role: string; epoch: number }>("SELECT role,epoch FROM app.identity_principal WHERE user_id=$1 FOR UPDATE", [identity.userId]);
  if (!principal.rows[0]) fail("UNAUTHENTICATED");
  const session = await client.query('SELECT 1 FROM auth.session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()', [identity.sessionId, identity.userId]);
  if (!session.rowCount) fail("UNAUTHENTICATED");
  if (epoch !== undefined && principal.rows[0].epoch !== epoch) fail("FORBIDDEN_OR_NOT_FOUND");
  return principal.rows[0];
}
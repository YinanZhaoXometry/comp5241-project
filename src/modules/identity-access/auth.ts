import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import { database } from "../../adapters/postgres/database";
import { config } from "../../platform/config";

export function createAuth(pool: Pool, provisioning = false) {
  const settings = config();
  return betterAuth({
    database: pool, secret: settings.authSecret, baseURL: settings.origin, basePath: "/api/v1/auth",
    trustedOrigins: [settings.origin],
    emailAndPassword: { enabled: true, disableSignUp: !provisioning, autoSignIn: !provisioning, minPasswordLength: 16 },
    session: { cookieCache: { enabled: false }, deferSessionRefresh: true, expiresIn: 86400, updateAge: 3600 },
    advanced: { database: { generateId: "uuid" }, defaultCookieAttributes: { httpOnly: true, sameSite: "strict", secure: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    logger: { disabled: true },
  });
}
const instances = new WeakMap<Pool, ReturnType<typeof createAuth>>();
export function auth() {
  const pool = database();
  let instance = instances.get(pool);
  if (!instance) { instance = createAuth(pool); instances.set(pool, instance); }
  return instance;
}
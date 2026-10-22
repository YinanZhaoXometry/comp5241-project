import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../../src/modules/identity-access/auth";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { getPreferences, savePreferences } from "../../src/modules/setup-preferences/service";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { closeQueue } from "../../src/adapters/queue";
import type { Command, Identity } from "../../src/contracts/setup";
import type { Goal, Preferences, SavePreferences, Stage } from "../../src/contracts/preferences";

const command = (revision = 0): Command => ({
  schemaVersion: 1,
  commandKey: crypto.randomUUID(),
  expectedRevision: revision,
});
type Content = Omit<Preferences, "revision">;
const content = (overrides: Partial<Content> = {}): Content => ({
  stage: "goal",
  goal: null,
  topic: "",
  clarification: "",
  background: "",
  timePreference: null,
  timezone: "",
  ...overrides,
});
const save = (
  identity: Identity,
  revision: number,
  overrides: Partial<Content> = {},
  key: Command = command(revision),
) => savePreferences(identity, { ...key, ...content(overrides) });

async function actor(label: string, role: "learner" | "instructor" | "admin" = "learner") {
  const credentials = await provisionSynthetic(label, role);
  const signed = await signIn(credentials);
  return { ...credentials, ...signed };
}
async function signIn(credentials: { email: string; password: string; userId: string }) {
  const response = await auth().api.signInEmail({
    body: { email: credentials.email, password: credentials.password },
    asResponse: true,
  });
  const body = await response.json();
  const session = await database().query<{ id: string }>(
    "SELECT id FROM auth.session WHERE token=$1",
    [body.token],
  );
  return { sessionId: session.rows[0].id };
}
afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe("real PostgreSQL setup preferences", () => {
  it("round-trips the pinned GET shape across the four goal routes, isolates owners and resumes after re-authentication", async () => {
    const a = await actor("pref-a");
    const before = await getPreferences(a);
    expect(before).toEqual({
      stage: "materials",
      goal: null,
      topic: "",
      clarification: "",
      background: "",
      timePreference: null,
      timezone: "",
      revision: 0,
    });
    let revision = 0;
    for (const [goal, clarification] of [
      ["Exam preparation", ""],
      ["Understand a topic", ""],
      ["Apply a skill", ""],
      ["Other", "Pass one synthetic course quiz"],
    ] as const) {
      const saved = await save(a, revision, { goal, clarification, topic: `Synthetic ${goal}` });
      revision += 1;
      expect(saved).toEqual({ stage: "goal", goal, topic: `Synthetic ${goal}`, clarification, background: "", timePreference: null, timezone: "", revision });
      expect(await getPreferences(a)).toEqual(saved);
    }
    const b = await actor("pref-b");
    expect((await getPreferences(b)).topic).toBe("");
    await save(b, 0, { topic: "Owner B separate state" });
    expect((await getPreferences(a)).topic).toBe("Synthetic Other");
    // Session expiry denies reads and writes; a fresh session for the same
    // owner reloads exactly the authorized saved work.
    const expiring = await actor("pref-expiry");
    await save(expiring, 0, { topic: "Saved before expiry" });
    await database().query(
      "UPDATE auth.session SET \"expiresAt\"=clock_timestamp()-interval '1 second' WHERE id=$1",
      [expiring.sessionId],
    );
    await expect(getPreferences(expiring)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(save(expiring, 0, { topic: "After expiry" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const renewed = await signIn(expiring);
    expect(
      await getPreferences({ userId: expiring.userId, sessionId: renewed.sessionId }),
    ).toMatchObject({ topic: "Saved before expiry" });
  });

  it("enforces exactly the four goal routes, Other-only short clarification and validated IANA timezone", async () => {
    const c = await actor("pref-invalid");
    const invalidInputs: SavePreferences[] = [
      { ...command(0), ...content({ goal: "Random goal" as unknown as Goal }) },
      { ...command(0), ...content({ goal: "Other", clarification: "" }) },
      { ...command(0), ...content({ goal: "Other", clarification: "   " }) },
      { ...command(0), ...content({ goal: "Understand a topic", clarification: "Clarification leaked to a non-Other goal" }) },
      { ...command(0), ...content({ topic: "t".repeat(161) }) },
      { ...command(0), ...content({ clarification: "c".repeat(241) }) },
      { ...command(0), ...content({ background: "b".repeat(401) }) },
      { ...command(0), ...content({ timezone: "Mars/Olympus" }) },
      { ...command(0), ...content({ stage: "unknown-stage" as unknown as Stage }) },
      { ...command(0), ...content({ timePreference: "whenever" as unknown as Preferences["timePreference"] }) },
      { ...command(0), ...content(), unexpected: true } as unknown as SavePreferences,
    ];
    for (const invalid of invalidInputs.map((value) => savePreferences(c, value))) {
      await expect(invalid).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(await getPreferences(c)).toEqual({
      stage: "materials",
      goal: null,
      topic: "",
      clarification: "",
      background: "",
      timePreference: null,
      timezone: "",
      revision: 0,
    });
    expect(
      (
        await database().query(
          "SELECT 1 FROM app.setup_preference WHERE owner_id=$1",
          [c.userId],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("bumps revision only for plan-relevant changes, rejects stale second-tab saves and replays one result", async () => {
    const d = await actor("pref-revision");
    const first = await save(d, 0, { goal: "Understand a topic", topic: "First topic" });
    expect(first.revision).toBe(1);
    // Identical re-save (fresh command) does not advance the pinned revision.
    const identical = await save(d, first.revision, { goal: "Understand a topic", topic: "First topic" });
    expect(identical.revision).toBe(1);
    // Optional preference and stage navigation changes never invalidate confirmation.
    // Saves are full-replace, so plan-relevant fields are carried unchanged here.
    const unchangedIntent = { goal: "Understand a topic", topic: "First topic" };
    const optional = await save(d, identical.revision, {
      ...unchangedIntent,
      background: "Self-taught synthetic learner",
      timePreference: "morning",
      timezone: "Asia/Shanghai",
    });
    expect(optional.revision).toBe(1);
    const stageMove = await save(d, optional.revision, { ...unchangedIntent, stage: "plan" });
    expect(stageMove.revision).toBe(1);
    expect((await getPreferences(d)).revision).toBe(1);
    // A plan-relevant change advances the pinned revision exactly once.
    const changed = await save(d, stageMove.revision, { topic: "Corrected topic" });
    expect(changed.revision).toBe(2);
    expect(changed.topic).toBe("Corrected topic");
    // Stale second tab: expectedRevision below the current revision CONFLICTs.
    await expect(save(d, 1, { topic: "Stale second tab" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getPreferences(d)).revision).toBe(2);
    // Concurrent identical commands commit exactly one effect and one result.
    const key = command(2);
    const body = { ...key, ...content({ goal: "Apply a skill", topic: "Concurrent topic" }) };
    const [left, right] = await Promise.all([savePreferences(d, body), savePreferences(d, body)]);
    expect(left).toEqual(right);
    expect(left.revision).toBe(3);
    // A lost-response retry of the same command returns the stored result.
    expect(await savePreferences(d, body)).toEqual(left);
    // The same command key with different bytes is replay misuse, not a save.
    await expect(
      savePreferences(d, { ...key, ...content({ goal: "Apply a skill", topic: "Different bytes" }) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getPreferences(d)).revision).toBe(3);
  });

  it("denies non-learners and protects the row-level invariants against raw writes", async () => {
    const e = await actor("pref-roles");
    for (const role of ["instructor", "admin"] as const) {
      const other = await actor(`pref-${role}`, role);
      await expect(getPreferences(other)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
      await expect(save(other, 0, { topic: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
    }
    await save(e, 0, { topic: "Learner state" });
    // Defense-in-depth: the SQL checks mirror the contract for any direct writer.
    const raw = await actor("pref-raw");
    await expect(
      database().query(
        "INSERT INTO app.setup_preference(owner_id,stage,goal,clarification) VALUES($1,'goal','Other','')",
        [raw.userId],
      ),
    ).rejects.toThrow();
    await expect(
      database().query(
        "INSERT INTO app.setup_preference(owner_id,stage,goal,clarification) VALUES($1,'goal','Understand a topic','clarification leaked to a non-Other goal')",
        [raw.userId],
      ),
    ).rejects.toThrow();
  });
});

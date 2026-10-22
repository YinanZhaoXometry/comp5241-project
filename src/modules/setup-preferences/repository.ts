import type { PoolClient } from "pg";
import type { Preferences, SavePreferences } from "../../contracts/preferences";

export type SetupPreferenceRow = {
  owner_id: string;
  stage: string;
  goal: string | null;
  topic: string;
  clarification: string;
  background: string;
  time_preference: string | null;
  timezone: string;
  revision: number;
  command_key: string | null;
  request_hash: string | null;
  result: Preferences | null;
};

export async function preferenceRow(client: PoolClient, ownerId: string): Promise<SetupPreferenceRow | undefined> {
  // Row lock serializes concurrent saves and replay checks per owner.
  const found = await client.query<SetupPreferenceRow>("SELECT * FROM app.setup_preference WHERE owner_id=$1 FOR UPDATE", [ownerId]);
  return found.rows[0];
}

export async function upsertPreference(client: PoolClient, ownerId: string, value: SavePreferences, revision: number, commandKey: string, hash: string, result: Preferences) {
  await client.query(
    `INSERT INTO app.setup_preference(owner_id,stage,goal,topic,clarification,background,time_preference,timezone,revision,command_key,request_hash,result)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(owner_id) DO UPDATE SET stage=$2,goal=$3,topic=$4,clarification=$5,background=$6,time_preference=$7,timezone=$8,revision=$9,command_key=$10,request_hash=$11,result=$12,saved_at=clock_timestamp(),updated_at=clock_timestamp()`,
    [ownerId, value.stage, value.goal, value.topic, value.clarification, value.background, value.timePreference, value.timezone, revision, commandKey, hash, result],
  );
}

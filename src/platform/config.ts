import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const schema = z.strictObject({
  databaseUrl: z.string(),
  authSecret: z.string().min(32),
  origin: z.literal('http://127.0.0.1:3000'),
});
export function config() {
  const data = schema.parse(
    JSON.parse(readFileSync(resolve('.local/runtime-config.json'), 'utf8')),
  );
  const database = new URL(data.databaseUrl);
  if (
    database.hostname !== '127.0.0.1' ||
    database.username !== 'tracer_runtime'
  )
    throw new Error('Local runtime database required');
  return {
    ...data,
    storagePath: resolve('.local/private-objects'),
    extractorPath: resolve('.local/bin/txt-extract'),
  };
}

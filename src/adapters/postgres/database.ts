import { Pool, type PoolClient } from 'pg';
import { config } from '../../platform/config';

let shared: Pool | undefined;
export function database() {
  shared ??= new Pool({
    connectionString: config().databaseUrl,
    max: 8,
    options:
      '-c search_path=app,auth,public -c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000',
  });
  return shared;
}
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
  pool = database(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function closeDatabase() {
  await shared?.end();
  shared = undefined;
}

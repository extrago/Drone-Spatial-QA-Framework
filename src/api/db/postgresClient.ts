import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * API-layer Singleton PostgreSQL Pool.
 *
 * Design Decision: A single shared pool avoids connection exhaustion under
 * concurrent API requests. The pool is created once at module load time and
 * reused for the lifetime of the server process.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host:     process.env.DB_HOST     ?? 'localhost',
      port:     parseInt(process.env.DB_PORT ?? '5432', 10),
      database: process.env.DB_NAME     ?? 'dronedb',
      user:     process.env.DB_USER     ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      max: 10,                    // max pool connections
      idleTimeoutMillis: 30_000,  // close idle connections after 30 s
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected error on idle client:', err);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

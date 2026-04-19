import { DbClient } from '../utils/DbClient';

/**
 * Global Setup — Runs once before all Playwright tests.
 *
 * Responsibilities:
 * 1. Verify DB connectivity (fail-fast before any test runs)
 * 2. Ensure seed drone exists in drones table
 * 3. Clear leftover test telemetry from previous runs
 */
export default async function globalSetup(): Promise<void> {
  console.log('\n[GlobalSetup] 🚀 Initialising Drone-Spatial-QA test environment...');

  const db = DbClient.getInstance();

  try {
    // Verify DB connection
    await db.query('SELECT 1');
    console.log('[GlobalSetup] ✅ Database connection verified');

    // Ensure test drones exist
    await db.query(`
      INSERT INTO drones (drone_id, name, status)
      VALUES ('DRONE-001', 'Alpha Delivery', 'active')
      ON CONFLICT (drone_id) DO NOTHING
    `);
    console.log('[GlobalSetup] ✅ Test drone seed verified');

    // Clear stale telemetry from previous test runs
    await db.query(`
      DELETE FROM telemetry_logs
      WHERE recorded_at < NOW() - INTERVAL '1 hour'
    `);
    console.log('[GlobalSetup] ✅ Stale telemetry cleaned');

  } catch (err) {
    console.error('[GlobalSetup] ❌ Setup failed:', err);
    throw err; // Causes Playwright to abort all tests with a clear error
  }

  console.log('[GlobalSetup] ✅ Environment ready\n');
}

import { DbClient } from '../utils/DbClient';

/**
 * Global Teardown — Runs once after all Playwright tests complete.
 *
 * Responsibilities:
 * 1. Close the singleton DB pool (prevents hanging process)
 * 2. Log completion for CI log clarity
 */
export default async function globalTeardown(): Promise<void> {
  console.log('\n[GlobalTeardown] 🧹 Closing DB pool...');
  await DbClient.getInstance().close();
  console.log('[GlobalTeardown] ✅ Teardown complete\n');
}

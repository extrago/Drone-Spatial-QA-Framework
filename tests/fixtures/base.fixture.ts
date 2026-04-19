import { test as base } from '@playwright/test';
import { DbClient } from '../utils/DbClient';
import { SpatialUtils } from '../utils/SpatialUtils';
import { DroneMapPage } from '../page-objects/DroneMapPage';

/**
 * Custom Fixture Types
 *
 * Design Decision: Extending Playwright's base test with fixtures provides:
 * 1. Automatic setup and teardown — no manual beforeEach/afterEach boilerplate
 * 2. Type-safe access to helpers across all spec files
 * 3. Single source of truth for dependency wiring
 */
export type DroneTestFixtures = {
  dbClient: DbClient;
  spatialUtils: SpatialUtils;
  droneMapPage: DroneMapPage;
};

export const test = base.extend<DroneTestFixtures>({
  /**
   * dbClient fixture — provides the Singleton DbClient.
   * Scope: test (each test gets a reference, but the pool is shared via Singleton)
   */
  dbClient: async ({}, use) => {
    const client = DbClient.getInstance();
    await use(client);
    // No pool.end() here — pool lives until globalTeardown
  },

  /**
   * spatialUtils fixture — stateless helper, safe to instantiate per test.
   */
  spatialUtils: async ({}, use) => {
    await use(new SpatialUtils());
  },

  /**
   * droneMapPage fixture — Page Object wired to the current Playwright Page.
   * Automatically available in all browser-based tests.
   */
  droneMapPage: async ({ page }, use) => {
    const mapPage = new DroneMapPage(page);
    await use(mapPage);
  },
});

export { expect } from '@playwright/test';

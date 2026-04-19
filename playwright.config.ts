import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env — allows overrides from environment (CI injects vars directly)
dotenv.config({ path: path.resolve(__dirname, '.env.example') });

/**
 * Playwright Configuration
 *
 * Design Decisions:
 * - Two browser projects (chromium + firefox) for cross-browser spatial rendering validation
 * - globalSetup seeds DB state once before all tests; globalTeardown cleans up
 * - Allure reporter provides rich test evidence including screenshots & traces
 * - testIdAttribute set to 'data-testid' to align with the Leaflet map DOM attributes
 */
export default defineConfig({
  testDir: './tests/specs',
  outputDir: './test-results',

  // Parallel execution (set to false for DB-integrity tests that share state)
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  globalSetup: './tests/setup/globalSetup.ts',
  globalTeardown: './tests/setup/globalTeardown.ts',

  use: {
    baseURL: process.env.UI_BASE_URL ?? 'http://localhost:8080',
    testIdAttribute: 'data-testid',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  reporter: [
    ['list'],
    ['allure-playwright', {
      detail: true,
      outputFolder: 'allure-results',
      suiteTitle: false,
    }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});

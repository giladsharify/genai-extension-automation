import { defineConfig } from '@playwright/test';
import 'dotenv/config';
import type { Options } from './src/fixtures.ts';

// Let context.route() see requests made by the extension's service worker.
// Default behavior since Playwright 1.65; kept for older versions.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const isCI = !!process.env.CI;

export default defineConfig<Options>({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 4,
  reporter: [
    ['list', { printSteps: false }],
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    headless: true,
    // Traces record typed values (the API key) and request URLs (which carry the key),
    // and CI artifacts of a public repo are downloadable, so only keep traces locally.
    trace: isCI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Videos are recorded by the context fixture (src/fixtures.ts): Playwright's `video`
    // option doesn't apply to the persistent contexts that extensions need.
  },
  projects: [
    {
      // Deterministic: the backend's rule answer is replaced by the policy in src/policy.ts.
      name: 'enforcement',
      testDir: './tests/enforcement',
      use: { policyMode: 'mock' },
    },
    {
      // End-to-end against the real Prompt Security tenant configured for this assignment.
      name: 'live',
      testDir: './tests/live',
      use: { policyMode: 'live' },
    },
  ],
});

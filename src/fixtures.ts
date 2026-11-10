import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ExtensionPopup } from './pages/ExtensionPopup.ts';
import { ruleActionFor } from './policy.ts';

export const EXTENSION_PATH = resolve(import.meta.dirname, '..', 'extension');

/** A decision the extension made for a domain ("Block", "Inspect", ...). */
export interface Decision {
  domain: string;
  action: string;
}

/** Live view of the extension's traffic with the Prompt Security backend. */
export interface BackendTraffic {
  /** Backend requests started but not yet finished. */
  inFlight: number;
  /** Heartbeat (config sync) requests started / answered with 200. */
  heartbeatsStarted: number;
  heartbeatsOk: number;
  /** Time of the last backend request start or finish. */
  lastActivityAt: number;
}

/** What the rule-endpoint mock did during the test. */
export interface MockStats {
  hits: number;
  errors: string[];
}

export interface Options {
  /**
   * mock: intercept the backend's rule answer and apply the policy in src/policy.ts.
   * live: let the real Prompt Security backend decide.
   */
  policyMode: 'mock' | 'live';
  /** Load the extension into the browser. */
  withExtension: boolean;
  /** Enter the API domain/key in the popup before the test. */
  configureExtension: boolean;
}

export interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  page: Page;
  /** Everything the extension's service worker logged during the test. */
  extensionLogs: string[];
  /** Every rule decision the extension logged during the test, in order. */
  decisions: Decision[];
  backend: BackendTraffic;
  mockStats: MockStats;
}

const DECISION_LOG = /Handling domain action '(\w+)' \| domain=([^\s,|]+)/;
const BACKEND_HOST = /(^|\.)prompt\.security$/;
const HEARTBEAT_PATH = '/api/extension/heartbeat';
/** How long the backend traffic must be quiet before the extension counts as ready. */
const QUIET_MS = 1_000;

export const test = base.extend<Fixtures & Options>({
  policyMode: ['mock', { option: true }],
  withExtension: [true, { option: true }],
  configureExtension: [true, { option: true }],

  extensionLogs: async ({}, use) => {
    await use([]);
  },

  decisions: async ({}, use) => {
    await use([]);
  },

  backend: async ({}, use) => {
    await use({ inFlight: 0, heartbeatsStarted: 0, heartbeatsOk: 0, lastActivityAt: 0 });
  },

  mockStats: async ({}, use) => {
    await use({ hits: 0, errors: [] });
  },

  context: async (
    { withExtension, policyMode, decisions, extensionLogs, backend, mockStats, headless },
    use,
    testInfo,
  ) => {
    if (withExtension && !existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`Extension not found at ${EXTENSION_PATH}. Run "npm run fetch-extension".`);
    }
    const userDataDir = mkdtempSync(join(tmpdir(), 'ps-ext-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Full Chromium (not the headless shell) is required for extensions.
      channel: 'chromium',
      headless,
      args: withExtension ? [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`] : [],
    });

    // Attach listeners before anything else so no early log line or request is missed.
    const watch = (sw: Worker) =>
      sw.on('console', (msg) => {
        extensionLogs.push(msg.text());
        const m = DECISION_LOG.exec(msg.text());
        if (m) decisions.push({ action: m[1], domain: m[2] });
      });
    context.serviceWorkers().forEach(watch);
    context.on('serviceworker', watch);
    trackBackendTraffic(context, backend);

    if (withExtension && policyMode === 'mock') {
      await mockRuleEndpoints(context, mockStats);
    }

    await use(context);

    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    if (decisions.length) {
      testInfo.annotations.push({
        type: 'extension decisions',
        description: decisions.map((d) => `${d.domain}=${d.action}`).join(', '),
      });
    }
    // Guard against a mocked test silently talking to the real backend
    // (e.g. if Playwright stops routing service-worker requests).
    if (mockStats.errors.length) {
      throw new Error(`Rule mock could not handle request(s): ${mockStats.errors.join('; ')}`);
    }
    if (withExtension && policyMode === 'mock' && decisions.length > 0 && mockStats.hits === 0) {
      throw new Error(
        'The extension made rule decisions but the rule mock was never hit, so the real backend decided. ' +
          'Check the route patterns in mockRuleEndpoints() (did the extension change endpoints?) and that ' +
          'Playwright still routes service-worker requests (PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS).',
      );
    }
  },

  serviceWorker: async ({ context, withExtension }, use) => {
    if (!withExtension) throw new Error('serviceWorker fixture used in a test without the extension');
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  page: async ({ context, withExtension, configureExtension, extensionLogs, backend }, use, testInfo) => {
    if (withExtension && configureExtension) {
      const { PS_API_DOMAIN, PS_API_KEY } = process.env;
      if (!PS_API_DOMAIN || !PS_API_KEY) {
        throw new Error('PS_API_DOMAIN and PS_API_KEY must be set (see .env.example)');
      }
      let [sw] = context.serviceWorkers();
      sw ??= await context.waitForEvent('serviceworker');
      const popup = await ExtensionPopup.open(context, new URL(sw.url()).host);
      await popup.save(PS_API_DOMAIN, PS_API_KEY);
      await waitForStoredSettings(sw, PS_API_DOMAIN, PS_API_KEY);
      await popup.close();
      await waitForBackendSync(backend, extensionLogs);
    }
    const page = await context.newPage();
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('final-url', { body: page.url(), contentType: 'text/plain' });
    }
  },
});

/** Wait until the popup's Save has been written to the extension's storage. */
export async function waitForStoredSettings(sw: Worker, apiDomain: string, apiKey: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await sw.evaluate(() => chrome.storage.local.get(['apiDomain', 'apiKey']));
        // Return booleans only, so a failure never prints the key.
        return { apiDomainSaved: s.apiDomain === apiDomain, apiKeySaved: s.apiKey === apiKey };
      },
      { message: 'popup settings were not saved to extension storage', timeout: 10_000 },
    )
    .toEqual({ apiDomainSaved: true, apiKeySaved: true });
}

/**
 * Wait until the extension has finished syncing its configuration with the backend.
 * The extension only knows which sites are GenAI apps after this sync, and saving
 * can start more than one sync in parallel, so "the first one finished" is not enough:
 * every heartbeat started must have finished processing and the backend traffic must
 * have gone quiet.
 */
export async function waitForBackendSync(backend: BackendTraffic, extensionLogs: string[]): Promise<void> {
  const completedLogs = () => extensionLogs.filter((l) => l.includes('Heartbeat completed')).length;
  await expect
    .poll(
      () => ({
        heartbeatSucceeded: backend.heartbeatsOk > 0,
        allHeartbeatsProcessed: completedLogs() >= backend.heartbeatsStarted,
        noRequestsInFlight: backend.inFlight === 0,
        trafficQuiet: Date.now() - backend.lastActivityAt >= QUIET_MS,
      }),
      {
        message: 'extension did not finish syncing with the Prompt Security backend',
        timeout: 20_000,
        intervals: [250],
      },
    )
    .toEqual({ heartbeatSucceeded: true, allHeartbeatsProcessed: true, noRequestsInFlight: true, trafficQuiet: true });
}

function trackBackendTraffic(context: BrowserContext, backend: BackendTraffic): void {
  const isBackend = (url: string) => {
    try {
      return BACKEND_HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  };
  const done = () => {
    backend.inFlight = Math.max(0, backend.inFlight - 1);
    backend.lastActivityAt = Date.now();
  };
  context.on('request', (req) => {
    if (!isBackend(req.url())) return;
    backend.inFlight++;
    backend.lastActivityAt = Date.now();
    if (new URL(req.url()).pathname === HEARTBEAT_PATH) backend.heartbeatsStarted++;
  });
  context.on('requestfinished', async (req) => {
    if (!isBackend(req.url())) return;
    if (new URL(req.url()).pathname === HEARTBEAT_PATH) {
      const res = await req.response().catch(() => null);
      if (res?.status() === 200) backend.heartbeatsOk++;
    }
    done();
  });
  context.on('requestfailed', (req) => {
    if (isBackend(req.url())) done();
  });
}

/**
 * Replace the backend's per-domain rule answer with the policy from src/policy.ts.
 * Everything else (heartbeat, config, assets) still goes to the real backend.
 * Requires PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 (set in playwright.config.ts)
 * so routes also apply to the extension's service worker.
 */
async function mockRuleEndpoints(context: BrowserContext, stats: MockStats): Promise<void> {
  /** Read the domain the extension is asking about; on a malformed request, let it through and record why. */
  const domainOf = (body: unknown, endpoint: string): string | null => {
    const domain = (body as { domain?: unknown } | null)?.domain;
    if (typeof domain === 'string' && domain) return domain;
    stats.errors.push(`${endpoint}: request has no "domain" field`);
    return null;
  };
  const parse = (postData: string | null, endpoint: string): unknown => {
    try {
      return postData ? JSON.parse(postData) : null;
    } catch {
      stats.errors.push(`${endpoint}: request body is not JSON`);
      return null;
    }
  };

  // Current extension builds call this endpoint.
  await context.route('**/api/employee/evaluate-rule', async (route) => {
    const domain = domainOf(parse(route.request().postData(), 'evaluate-rule'), 'evaluate-rule');
    if (!domain) return route.continue();
    stats.hits++;
    await route.fulfill({
      json: {
        ruleInfo: {
          action: ruleActionFor(domain),
          isLogViolationsOnly: false,
          isWarnBeforeAccess: false,
          showDetectViolationsPopup: false,
          allowBypassProtections: false,
          dataProtection: {
            blockFileUpload: false,
            blockFileDownload: false,
            blockContentPaste: false,
            inspectFilesUploaded: false,
          },
        },
        autocompleteRegexes: [],
        platformType: 'web',
      },
    });
  });
  // Older rule engine endpoint, used when the "ruleBaseV2" setting is off.
  await context.route('**/api/extension/get-rule-action', async (route) => {
    const domain = domainOf(parse(route.request().postData(), 'get-rule-action'), 'get-rule-action');
    if (!domain) return route.continue();
    stats.hits++;
    const action = ruleActionFor(domain) === 'Block' ? 'Block' : 'Inspect';
    await route.fulfill({
      json: { action, canBypassBlock: 'Prevent', canBypassInspection: 'Prevent', warnBeforeDomainUsage: 'No' },
    });
  });
}

/**
 * Navigate without failing when the extension aborts the navigation by
 * redirecting the tab to its block page.
 */
export async function visit(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
  } catch (err) {
    const msg = String(err);
    if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|frame was detached|interrupted by another navigation/.test(msg)) throw err;
  }
}

export { expect };

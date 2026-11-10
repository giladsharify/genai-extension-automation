import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ExtensionPopup } from './pages/ExtensionPopup.ts';
import { normalizeDomain, ruleActionFor } from './policy.ts';

export const EXTENSION_PATH = resolve(import.meta.dirname, '..', 'extension');

/** A decision the extension made for a domain ("Block", "Inspect", ...). */
export interface Decision {
  domain: string;
  action: string;
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
  /** Rule decisions the extension logged during the test, in order. */
  decisions: Decision[];
  waitForDecision: (domain: string) => Promise<Decision>;
}

const DECISION_LOG = /Handling domain action '(\w+)' \| domain=([^\s,|]+)/;

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

  context: async ({ withExtension, policyMode, decisions, extensionLogs, headless }, use, testInfo) => {
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

    if (withExtension && policyMode === 'mock') {
      await mockRuleEndpoints(context);
    }

    const watch = (sw: Worker) =>
      sw.on('console', (msg) => {
        extensionLogs.push(msg.text());
        const m = DECISION_LOG.exec(msg.text());
        if (m) decisions.push({ action: m[1], domain: m[2] });
      });
    context.serviceWorkers().forEach(watch);
    context.on('serviceworker', watch);

    await use(context);

    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    if (decisions.length) {
      testInfo.annotations.push({
        type: 'extension decisions',
        description: decisions.map((d) => `${d.domain}=${d.action}`).join(', '),
      });
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

  page: async ({ context, withExtension, configureExtension, extensionLogs }, use, testInfo) => {
    if (withExtension && configureExtension) {
      const { PS_API_DOMAIN, PS_API_KEY } = process.env;
      if (!PS_API_DOMAIN || !PS_API_KEY) {
        throw new Error('PS_API_DOMAIN and PS_API_KEY must be set (see .env.example)');
      }
      let [sw] = context.serviceWorkers();
      sw ??= await context.waitForEvent('serviceworker');
      const popup = await ExtensionPopup.open(context, new URL(sw.url()).host);
      await popup.configure(PS_API_DOMAIN, PS_API_KEY);
      // The extension only knows which sites are GenAI apps after its first
      // sync ("heartbeat") with the backend; navigating earlier skips enforcement.
      await expect
        .poll(() => extensionLogs.some((l) => l.includes('Heartbeat completed')), {
          message: 'extension did not finish syncing with the Prompt Security backend',
          timeout: 20_000,
        })
        .toBe(true);
      await popup.close();
    }
    const page = await context.newPage();
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('final-url', { body: page.url(), contentType: 'text/plain' });
    }
  },

  waitForDecision: async ({ decisions }, use) => {
    await use(async (domain: string) => {
      let found: Decision | undefined;
      await expect
        .poll(() => (found = decisions.find((d) => normalizeDomain(d.domain) === normalizeDomain(domain))), {
          message: `extension never evaluated ${domain}`,
          timeout: 15_000,
        })
        .toBeTruthy();
      return found!;
    });
  },
});

/**
 * Replace the backend's per-domain rule answer with the policy from src/policy.ts.
 * Everything else (heartbeat, config, assets) still goes to the real backend.
 * Requires PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 (set in playwright.config.ts)
 * so routes also apply to the extension's service worker.
 */
async function mockRuleEndpoints(context: BrowserContext): Promise<void> {
  // Current extension builds call this endpoint.
  await context.route('**/api/employee/evaluate-rule', async (route) => {
    const { domain } = route.request().postDataJSON() as { domain: string };
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
    const { domain } = route.request().postDataJSON() as { domain: string };
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

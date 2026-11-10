import { expect, type Page } from '@playwright/test';
import type { Decision } from './fixtures.ts';
import { BlockPage } from './pages/BlockPage.ts';
import { normalizeDomain } from './policy.ts';

/** Time to give the extension to redirect after it has made its decision. */
const SETTLE_MS = 3_000;

/** All decisions the extension has made so far for a domain. */
export function decisionsFor(decisions: Decision[], domain: string): Decision[] {
  return decisions.filter((d) => normalizeDomain(d.domain) === normalizeDomain(domain));
}

/**
 * Wait until the extension has evaluated the domain at least once.
 * It usually evaluates a domain several times per navigation (navigation,
 * script injection, account check), so callers should look at all of them.
 */
export async function waitForDecisions(decisions: Decision[], domain: string): Promise<Decision[]> {
  await expect
    .poll(() => decisionsFor(decisions, domain).length, {
      message: `extension never evaluated ${domain}`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  return decisionsFor(decisions, domain);
}

/**
 * Assert that the extension evaluated the domain, never decided to block it,
 * and the tab stayed on the site.
 */
export async function expectAllowed(page: Page, domain: string, decisions: Decision[]): Promise<void> {
  await waitForDecisions(decisions, domain);
  await page.waitForTimeout(SETTLE_MS);
  // Re-read after the settle time so late decisions are included too.
  const actions = decisionsFor(decisions, domain).map((d) => d.action);
  expect(actions, `extension decisions for ${domain}`).not.toContain('Block');
  await expectStillOn(page, domain);
}

/** Assert the tab is still on the given site and not on the block page. */
export async function expectStillOn(page: Page, domain: string): Promise<void> {
  expect(page.url(), `${domain} should not be blocked`).not.toMatch(BlockPage.URL_PATTERN);
  expect(normalizeDomain(new URL(page.url()).hostname)).toBe(normalizeDomain(domain));
}

/** Wait for the page to load, give the extension time to act, then check nothing happened. */
export async function expectUntouched(page: Page, domain: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(SETTLE_MS);
  await expectStillOn(page, domain);
}

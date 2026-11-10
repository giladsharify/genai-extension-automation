import { expect, type Page } from '@playwright/test';
import type { Decision } from './fixtures.ts';
import { BlockPage } from './pages/BlockPage.ts';

/** Time to give the extension to redirect after it has made its decision. */
const SETTLE_MS = 3_000;

/**
 * Assert that the extension evaluated the domain, decided not to block it,
 * and the tab stayed on the site.
 */
export async function expectAllowed(
  page: Page,
  domain: string,
  waitForDecision: (domain: string) => Promise<Decision>,
): Promise<void> {
  const decision = await waitForDecision(domain);
  expect(decision.action, `extension decision for ${domain}`).not.toBe('Block');
  await page.waitForTimeout(SETTLE_MS);
  await expectStillOn(page, domain);
}

/** Assert the tab is still on the given site and not on the block page. */
export async function expectStillOn(page: Page, domain: string): Promise<void> {
  expect(page.url(), `${domain} should not be blocked`).not.toMatch(BlockPage.URL_PATTERN);
  expect(new URL(page.url()).hostname.replace(/^www\./, '')).toBe(domain.replace(/^www\./, ''));
}

/** Wait for the page to load, give the extension time to act, then check nothing happened. */
export async function expectUntouched(page: Page, domain: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(SETTLE_MS);
  await expectStillOn(page, domain);
}

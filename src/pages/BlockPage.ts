import { expect, type Page } from '@playwright/test';
import { normalizeDomain } from '../policy.ts';

/**
 * Page object for the extension's "Access Denied" page.
 * When a site is blocked, the extension redirects the tab to
 * chrome-extension://<id>/html/pageOverlay.html?originalUrl=…&domain=…&type=blockPage
 */
export class BlockPage {
  static readonly URL_PATTERN = /^chrome-extension:\/\/[a-p]{32}\/html\/pageOverlay\.html\?.*type=blockPage/;

  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get title() {
    return this.page.locator('#title-text');
  }

  get message() {
    return this.page.locator('#message-title');
  }

  get accessButton() {
    return this.page.locator('#access-button');
  }

  /** Query parameters the extension passes to the block page. */
  params(): URLSearchParams {
    return new URL(this.page.url()).searchParams;
  }

  async expectShownFor(domain: string, timeout = 15_000): Promise<void> {
    await expect(this.page, `expected ${domain} to be blocked`).toHaveURL(BlockPage.URL_PATTERN, { timeout });
    expect(normalizeDomain(this.params().get('domain') ?? '')).toBe(normalizeDomain(domain));
    await expect(this.title).toHaveText('Access Denied');
    await expect(this.message).toContainText(domain);
    await expect(this.message).toContainText('blocked by your administrator');
  }
}

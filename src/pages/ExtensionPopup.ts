import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Page object for the extension's toolbar popup (html/popup.html). */
export class ExtensionPopup {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  static async open(context: BrowserContext, extensionId: string): Promise<ExtensionPopup> {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/html/popup.html`);
    return new ExtensionPopup(page);
  }

  get apiDomain() {
    return this.page.locator('#apiDomain');
  }

  get apiKey() {
    return this.page.locator('#apiKey');
  }

  get saveButton() {
    return this.page.locator('#saveButton');
  }

  async configure(apiDomain: string, apiKey: string): Promise<void> {
    await this.apiDomain.fill(apiDomain);
    await this.apiKey.fill(apiKey);
    await this.saveButton.click();
    // Saving persists the values; reopening the popup should show them.
    await this.page.reload();
    await expect(this.apiDomain).toHaveValue(apiDomain);
    await expect(this.apiKey).toHaveValue(apiKey);
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

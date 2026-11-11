import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

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

  /**
   * Fill in and click Save. Saving is asynchronous, so callers must wait for the
   * values to be persisted (see waitForStoredSettings in fixtures.ts) before
   * reloading or closing the popup.
   */
  async save(apiDomain: string, apiKey: string): Promise<void> {
    await this.apiDomain.fill(apiDomain);
    await this.fillSecret(this.apiKey, apiKey);
    await this.saveButton.click();
  }

  /**
   * Type a secret without it appearing in reports. locator.fill() puts the value
   * in the step title ('Fill "<value>"'), which ends up in the HTML report.
   * evaluate() steps don't show their arguments.
   */
  private async fillSecret(input: Locator, value: string): Promise<void> {
    await input.evaluate((el: HTMLInputElement, v) => {
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  /** Reopen the popup and check it shows the saved settings. */
  async expectShowsSaved(apiDomain: string, apiKey: string): Promise<void> {
    await this.page.reload();
    await expect(this.apiDomain).toHaveValue(apiDomain);
    // Compare without putting the secret in the assertion message.
    expect((await this.apiKey.inputValue()) === apiKey, 'popup shows the saved API key').toBe(true);
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

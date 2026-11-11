import { expect, type BrowserContext } from '@playwright/test';

/**
 * Page object for chrome://serviceworker-internals, used to stop the extension's
 * background service worker the way Chrome does when a Manifest V3 worker goes idle.
 */
export class ServiceWorkerInternals {
  /** Stop the extension's service worker and wait until Chrome reports it stopped. */
  static async stopExtensionWorker(context: BrowserContext, extensionId: string): Promise<void> {
    const page = await context.newPage();
    try {
      await page.goto('chrome://serviceworker-internals/');
      const registration = page.locator('.serviceworker-registration', { hasText: `chrome-extension://${extensionId}/` });
      const status = registration.locator('.serviceworker-running-status .value').first();
      await expect(status).toHaveText('RUNNING');
      await registration.locator('cr-button[data-command="stop"]').first().click();
      await expect(status, 'extension service worker should be stopped').toHaveText('STOPPED');
    } finally {
      await page.close();
    }
  }
}

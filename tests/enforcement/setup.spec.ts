import { expect, test, EXTENSION_PATH, waitForBackendSync, waitForStoredSettings } from '../../src/fixtures.ts';
import { ExtensionPopup } from '../../src/pages/ExtensionPopup.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('Extension setup', () => {
  test.use({ configureExtension: false });

  test('extension loads and its background service worker starts', async ({ serviceWorker, extensionId }) => {
    const manifest = JSON.parse(readFileSync(join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/${manifest.background.service_worker}`);
    const name = await serviceWorker.evaluate(() => chrome.runtime.getManifest().name);
    expect(name).toBe('Prompt Security Browser Extension');
  });

  test('popup saves the API domain and key and the extension connects to the backend', async ({
    context,
    extensionId,
    serviceWorker,
    backend,
    extensionLogs,
  }) => {
    const domain = process.env.PS_API_DOMAIN!;
    const key = process.env.PS_API_KEY!;

    const popup = await ExtensionPopup.open(context, extensionId);
    await popup.save(domain, key);

    // Saved to the extension's storage (checked without printing the key)...
    await waitForStoredSettings(serviceWorker, domain, key);
    // ...shown again when the popup is reopened...
    await popup.expectShowsSaved(domain, key);
    // ...and the extension completed its config sync with the backend.
    await waitForBackendSync(backend, extensionLogs);
    expect(backend.heartbeatsOk, 'successful heartbeats with the Prompt Security backend').toBeGreaterThan(0);
  });
});

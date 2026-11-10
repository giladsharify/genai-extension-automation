import { expect, test, EXTENSION_PATH } from '../../src/fixtures.ts';
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
  }) => {
    const domain = process.env.PS_API_DOMAIN!;
    const key = process.env.PS_API_KEY!;

    const heartbeat = context.waitForEvent('response', {
      predicate: (r) => r.url().includes(`${domain}/api/extension/heartbeat`),
      timeout: 20_000,
    });

    const popup = await ExtensionPopup.open(context, extensionId);
    await popup.configure(domain, key);

    const response = await heartbeat;
    expect(response.status(), 'heartbeat with the Prompt Security backend').toBe(200);

    const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(['apiDomain', 'apiKey']));
    expect(stored).toEqual({ apiDomain: domain, apiKey: key });
  });
});

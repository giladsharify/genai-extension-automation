import { expect, test, visit } from '../../src/fixtures.ts';
import { BlockPage } from '../../src/pages/BlockPage.ts';
import { BLOCKED_GENAI_APPS, normalizeDomain } from '../../src/policy.ts';

test.describe('Blocked GenAI apps (negative)', () => {
  for (const app of BLOCKED_GENAI_APPS) {
    test(`${app.name} is blocked — ${app.url}`, async ({ page }) => {
      await visit(page, app.url);
      const blockPage = new BlockPage(page);
      await blockPage.expectShownFor(normalizeDomain(new URL(app.url).hostname));
      // The site may have redirected first (e.g. / -> /app, bot-check tokens), so compare hosts.
      expect(new URL(blockPage.params().get('originalUrl')!).hostname).toBe(new URL(app.url).hostname);
    });
  }

  test('block page does not offer a bypass when the policy forbids it', async ({ page }) => {
    await visit(page, 'https://gemini.google.com/');
    const blockPage = new BlockPage(page);
    await blockPage.expectShownFor('gemini.google.com');
    expect(blockPage.params().get('canBypass')).toBe('Prevent');
    await expect(blockPage.accessButton).toBeHidden();
  });
});

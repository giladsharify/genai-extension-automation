import { expectUntouched } from '../../src/assertions.ts';
import { expect, test, visit } from '../../src/fixtures.ts';
import { BlockPage } from '../../src/pages/BlockPage.ts';

/** Ways a user might try to reach a blocked app anyway. */
test.describe('Bypass attempts', () => {
  test('Back and Forward from the block page never show the blocked app', async ({ page }) => {
    await visit(page, 'https://example.com/');
    await visit(page, 'https://gemini.google.com/');
    await new BlockPage(page).expectShownFor('gemini.google.com');

    for (const move of ['back', 'forward'] as const) {
      await (move === 'back' ? page.goBack() : page.goForward()).catch(() => {}); // aborted by a redirect is fine
      await page.waitForTimeout(3_000);
      // Either the block page again or the page before it, but never Gemini itself.
      expect(page.url(), `after ${move}`).toMatch(new RegExp(`${BlockPage.URL_PATTERN.source}|^https://example\\.com/`));
    }
  });

  // The browser rewrites these to the canonical hostname before the extension sees them.
  for (const url of ['https://GEMINI.Google.com/', 'https://gemini.google.com:443/', 'http://gemini.google.com/']) {
    test(`hostname variant ${url} is blocked`, async ({ page }) => {
      await visit(page, url);
      await new BlockPage(page).expectShownFor('gemini.google.com');
    });
  }

  test('trailing-dot hostname https://gemini.google.com./ ends up blocked', async ({ page }) => {
    // Google redirects the dotted name to gemini.google.com, which is then blocked.
    await visit(page, 'https://gemini.google.com./');
    await new BlockPage(page).expectShownFor('gemini.google.com');
  });

  /**
   * FINDING (v7.1.89): the extension doesn't recognize the trailing-dot form of a
   * hostname ("gemini.google.com." is the same site as "gemini.google.com").
   * Gemini is only blocked because Google's server redirects; a GenAI app that
   * serves its fully qualified name directly would not be blocked.
   * The test serves a placeholder page so no server redirect happens. If the
   * extension starts blocking this, the test fails: then change it to expect a block.
   */
  test('FINDING: the extension itself ignores the trailing-dot hostname', async ({ context, page, ruleMock, decisions }) => {
    test.info().annotations.push({ type: 'finding', description: 'gemini.google.com. is not evaluated by the extension' });
    await context.route(/^https:\/\/gemini\.google\.com\.\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>placeholder</title><h1>placeholder</h1>' }),
    );
    await visit(page, 'https://gemini.google.com./');
    await expectUntouched(page, 'gemini.google.com.');
    expect(ruleMock.requests).toEqual([]);
    expect(decisions).toEqual([]);
  });
});

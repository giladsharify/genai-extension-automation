import { expectUntouched } from '../../src/assertions.ts';
import { expect, test, visit } from '../../src/fixtures.ts';

/**
 * Control group: prove the blocking comes from the configured extension,
 * not from the network, the site, or the test setup.
 */
test.describe('Control (blocking is caused by the configured extension)', () => {
  test.describe('without the extension', () => {
    test.use({ withExtension: false });

    test('Gemini loads normally', async ({ page }) => {
      await visit(page, 'https://gemini.google.com/');
      await expectUntouched(page, 'gemini.google.com');
    });
  });

  test.describe('with the extension installed but not configured', () => {
    test.use({ configureExtension: false });

    test('Gemini is not blocked and no rule is evaluated', async ({ page, decisions }) => {
      await visit(page, 'https://gemini.google.com/');
      await expectUntouched(page, 'gemini.google.com');
      expect(decisions).toEqual([]);
    });
  });
});

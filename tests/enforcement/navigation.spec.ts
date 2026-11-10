import { expectAllowed, expectUntouched } from '../../src/assertions.ts';
import { expect, test, visit } from '../../src/fixtures.ts';
import { BlockPage } from '../../src/pages/BlockPage.ts';

test.describe('Navigation edge cases', () => {
  test('moving from an allowed app to a blocked app in the same tab gets blocked', async ({
    page,
    waitForDecision,
  }) => {
    await visit(page, 'https://chatgpt.com/');
    await expectAllowed(page, 'chatgpt.com', waitForDecision);

    await visit(page, 'https://gemini.google.com/');
    await new BlockPage(page).expectShownFor('gemini.google.com');
  });

  test('a blocked app opened in a new tab is blocked', async ({ context, page }) => {
    await visit(page, 'https://example.com/');
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => window.open('https://gemini.google.com/', '_blank')),
    ]);
    await new BlockPage(newTab).expectShownFor('gemini.google.com');
  });

  test('a blocked app stays blocked on a second visit', async ({ page }) => {
    await visit(page, 'https://gemini.google.com/');
    await new BlockPage(page).expectShownFor('gemini.google.com');

    await visit(page, 'https://example.com/');
    await expectUntouched(page, 'example.com');

    await visit(page, 'https://gemini.google.com/');
    await new BlockPage(page).expectShownFor('gemini.google.com');
  });

  test('a non-GenAI site is neither evaluated nor blocked', async ({ page, decisions }) => {
    await visit(page, 'https://example.com/');
    await expectUntouched(page, 'example.com');
    expect(decisions.filter((d) => d.domain.endsWith('example.com'))).toEqual([]);
  });
});

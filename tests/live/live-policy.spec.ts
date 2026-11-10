import { expectAllowed } from '../../src/assertions.ts';
import { test, visit } from '../../src/fixtures.ts';
import { BlockPage } from '../../src/pages/BlockPage.ts';

/**
 * End-to-end against the real Prompt Security tenant. No mocking: the backend decides.
 *
 * KNOWN ISSUE: as of 2026-11-10 the tenant answers "Protect" (allow + inspect) for
 * every GenAI domain, including gemini.google.com, so Gemini is not blocked.
 * The Gemini test is marked as an expected failure. If the tenant gets fixed,
 * Playwright reports it as "unexpectedly passed" and the annotation should be removed.
 */
test.describe('Live tenant policy', () => {
  test('ChatGPT is allowed — https://chatgpt.com/', async ({ page, waitForDecision }) => {
    await visit(page, 'https://chatgpt.com/');
    await expectAllowed(page, 'chatgpt.com', waitForDecision);
  });

  test('Gemini is blocked — https://gemini.google.com/', async ({ page, waitForDecision }) => {
    test.fail(
      true,
      'Known issue: the live tenant returns "Protect" instead of "Block" for gemini.google.com',
    );
    await visit(page, 'https://gemini.google.com/');
    const decision = await waitForDecision('gemini.google.com');
    test.info().annotations.push({ type: 'live decision', description: `gemini.google.com=${decision.action}` });
    await new BlockPage(page).expectShownFor('gemini.google.com');
  });
});

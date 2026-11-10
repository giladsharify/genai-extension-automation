import { decisionsFor, expectAllowed, waitForDecisions } from '../../src/assertions.ts';
import { test, visit } from '../../src/fixtures.ts';
import { BlockPage } from '../../src/pages/BlockPage.ts';

/**
 * End-to-end against the real Prompt Security tenant. No mocking: the backend decides.
 *
 * KNOWN ISSUE: as of 2026-11-10 the tenant answers "Protect" (allow + inspect) for
 * every GenAI domain, including gemini.google.com, so Gemini is not blocked.
 * The Gemini test is marked as an expected failure only when that exact cause is
 * observed. Any other failure (backend down, bad key, no decision) still fails the run.
 * If the tenant gets fixed, the test simply passes.
 */
test.describe('Live tenant policy', () => {
  test('ChatGPT is allowed — https://chatgpt.com/', async ({ page, decisions }) => {
    await visit(page, 'https://chatgpt.com/');
    await expectAllowed(page, 'chatgpt.com', decisions);
  });

  test('Gemini is blocked — https://gemini.google.com/', async ({ page, decisions }) => {
    await visit(page, 'https://gemini.google.com/');

    // Must succeed: the extension has to evaluate Gemini with the live backend.
    await waitForDecisions(decisions, 'gemini.google.com');
    const actions = decisionsFor(decisions, 'gemini.google.com').map((d) => d.action);
    test.info().annotations.push({ type: 'live decisions', description: `gemini.google.com=${actions.join(',')}` });

    test.fail(
      !actions.includes('Block'),
      `Known issue: the live tenant returns "${actions[0]}" instead of "Block" for gemini.google.com`,
    );
    await new BlockPage(page).expectShownFor('gemini.google.com');
  });
});

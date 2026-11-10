import { expectAllowed } from '../../src/assertions.ts';
import { test, visit } from '../../src/fixtures.ts';
import { ALLOWED_GENAI_APPS } from '../../src/policy.ts';

test.describe('Allowed GenAI apps (positive)', () => {
  for (const app of ALLOWED_GENAI_APPS) {
    test(`${app.name} is allowed — ${app.url}`, async ({ page, waitForDecision }) => {
      await visit(page, app.url);
      await expectAllowed(page, new URL(app.url).hostname, waitForDecision);
    });
  }
});

import { decisionsFor, expectAllowed, expectUntouched } from '../../src/assertions.ts';
import { expect, test, visit, type RuleMock } from '../../src/fixtures.ts';
import { BlockPage } from '../../src/pages/BlockPage.ts';
import { ServiceWorkerInternals } from '../../src/pages/ServiceWorkerInternals.ts';

/**
 * How the extension behaves when it cannot get a rule answer from the backend.
 *
 * OBSERVED (extension v7.1.80): it FAILS OPEN. If the rule request errors, drops,
 * or takes longer than the extension's 5 s timeout, the site is not blocked.
 * These tests pin that behavior so a change is noticed. If product decides the
 * extension should fail closed, flip OUTAGE_BEHAVIOR and the tests follow.
 */
const OUTAGE_BEHAVIOR: 'fail-open' | 'fail-closed' = 'fail-open';
const GEMINI = 'https://gemini.google.com/';

/** Wait until the extension has asked the (mocked) backend about a domain. */
async function waitForRuleRequest(ruleMock: RuleMock, domain: string, timeout = 15_000) {
  await expect
    .poll(() => ruleMock.requests.includes(domain), { message: `extension never asked the backend about ${domain}`, timeout })
    .toBe(true);
}

async function expectOutageBehavior(page: import('@playwright/test').Page) {
  if (OUTAGE_BEHAVIOR === 'fail-open') {
    await expectUntouched(page, 'gemini.google.com');
  } else {
    await new BlockPage(page).expectShownFor('gemini.google.com');
  }
}

test.describe('Backend failures (SYS-01, SYS-02)', () => {
  const failures: { name: string; failure: RuleMock['failure'] }[] = [
    { name: 'HTTP 500', failure: { status: 500 } },
    { name: 'HTTP 503', failure: { status: 503 } },
    { name: 'connection failure', failure: 'connection-failed' },
  ];

  for (const { name, failure } of failures) {
    test(`rule request ${name}: extension ${OUTAGE_BEHAVIOR === 'fail-open' ? 'fails open' : 'fails closed'}, then blocks again once the backend recovers`, async ({
      context,
      page,
      ruleMock,
      decisions,
    }) => {
      test.info().annotations.push({ type: 'finding', description: `During a backend outage the extension is ${OUTAGE_BEHAVIOR}.` });

      // Outage: the extension asks, gets an error, and makes no decision.
      ruleMock.failure = failure;
      await visit(page, GEMINI);
      await waitForRuleRequest(ruleMock, 'gemini.google.com');
      await expectOutageBehavior(page);
      expect(decisionsFor(decisions, 'gemini.google.com'), 'no decision should be made from a failed request').toEqual([]);

      // Recovery: a failed answer must not be cached; the next visit asks again and is blocked.
      ruleMock.failure = null;
      const requestsBefore = ruleMock.requests.length;
      const tab = await context.newPage();
      await visit(tab, GEMINI);
      await new BlockPage(tab).expectShownFor('gemini.google.com');
      expect(ruleMock.requests.length, 'extension should ask the backend again after recovery').toBeGreaterThan(requestsBefore);
    });
  }
});

test.describe('Backend response time vs the extension\'s 5 s timeout (BND-04)', () => {
  // A 1 s margin on each side of the 5 s cutoff keeps these stable on slow CI machines.
  test('a rule answer after 4 s is still enforced', async ({ page, ruleMock }) => {
    ruleMock.delayMs = 4_000;
    await visit(page, GEMINI);
    await new BlockPage(page).expectShownFor('gemini.google.com', 20_000);
  });

  test(`a rule answer after 6 s is too late: extension ${OUTAGE_BEHAVIOR === 'fail-open' ? 'fails open' : 'fails closed'}`, async ({
    page,
    ruleMock,
    decisions,
  }) => {
    test.info().annotations.push({ type: 'finding', description: `A slow backend (>5 s) makes the extension ${OUTAGE_BEHAVIOR}.` });
    ruleMock.delayMs = 6_000;
    await visit(page, GEMINI);
    await waitForRuleRequest(ruleMock, 'gemini.google.com');
    // Wait past the 5 s timeout plus the 6 s answer, then check what happened.
    await page.waitForTimeout(7_000);
    await expectOutageBehavior(page);
    expect(decisionsFor(decisions, 'gemini.google.com')).toEqual([]);
  });
});

test.describe('Service worker lifecycle (SYS-05)', () => {
  test('a blocked app is still blocked after Chrome stops the idle background worker', async ({
    context,
    page,
    extensionId,
    ruleMock,
  }) => {
    await visit(page, GEMINI);
    await new BlockPage(page).expectShownFor('gemini.google.com');

    // Manifest V3 workers are stopped when idle; in-memory state (like the decision cache) is lost.
    await ServiceWorkerInternals.stopExtensionWorker(context, extensionId);

    const requestsBefore = ruleMock.requests.length;
    const tab = await context.newPage();
    await visit(tab, GEMINI);
    await new BlockPage(tab).expectShownFor('gemini.google.com');
    expect(ruleMock.requests.length, 'restarted worker should evaluate the domain again').toBeGreaterThan(requestsBefore);
  });

  test('an allowed app is still allowed after the background worker restarts', async ({
    context,
    page,
    extensionId,
    decisions,
  }) => {
    await ServiceWorkerInternals.stopExtensionWorker(context, extensionId);
    await visit(page, 'https://chatgpt.com/');
    await expectAllowed(page, 'chatgpt.com', decisions);
  });
});

/**
 * OBSERVED: decisions are cached in memory per domain. A policy change on the
 * backend is ignored for a domain the extension has already evaluated, until a
 * config sync clears the cache (in production: the periodic sync, at most every
 * 15 minutes, or the 12-hour cache reset).
 */
test.describe('Policy change during a session (SYS-07)', () => {
  test('an app the admin newly blocks stays allowed until the next config sync, then is blocked', async ({
    context,
    page,
    ruleMock,
    decisions,
    forceConfigSync,
  }) => {
    // Start with Gemini allowed.
    ruleMock.overrides.set('gemini.google.com', 'Protect');
    await visit(page, GEMINI);
    await expectAllowed(page, 'gemini.google.com', decisions);

    // Admin blocks Gemini. Before a sync, the extension still uses its cached decision.
    ruleMock.overrides.clear();
    const cachedTab = await context.newPage();
    await visit(cachedTab, GEMINI);
    await expectUntouched(cachedTab, 'gemini.google.com');
    await cachedTab.close();

    // A config sync drops the cached decision; the next visit asks again and is blocked.
    await forceConfigSync();
    const tab = await context.newPage();
    await visit(tab, GEMINI);
    await new BlockPage(tab).expectShownFor('gemini.google.com');
  });

  test('an app the admin unblocks is allowed after the next config sync', async ({
    context,
    page,
    ruleMock,
    decisions,
    forceConfigSync,
  }) => {
    await visit(page, GEMINI);
    await new BlockPage(page).expectShownFor('gemini.google.com');

    ruleMock.overrides.set('gemini.google.com', 'Protect');
    await forceConfigSync();

    const tab = await context.newPage();
    const before = decisions.length;
    await visit(tab, GEMINI);
    await expectUntouched(tab, 'gemini.google.com');
    const newActions = decisions.slice(before).filter((d) => d.domain === 'gemini.google.com').map((d) => d.action);
    expect(newActions.length, 'Gemini should be evaluated again after the sync').toBeGreaterThan(0);
    expect(newActions).not.toContain('Block');
  });
});

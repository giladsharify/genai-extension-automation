import { expectUntouched } from '../../src/assertions.ts';
import { expect, test, visit } from '../../src/fixtures.ts';

/**
 * Domain-matching boundaries (BND-01).
 *
 * These hostnames don't exist, so the test serves a placeholder page for them
 * with context.route(). The browser still navigates to the real URL, so the
 * extension sees exactly the hostname a user would.
 *
 * OBSERVED (v7.1.89): the extension recognizes GenAI apps by exact hostname.
 * Lookalikes and unknown subdomains are not treated as GenAI apps at all: they
 * are never evaluated, so they can't inherit chatgpt.com's "allowed" decision
 * (or gemini.google.com's "blocked" one).
 */
const FAKE_HOSTS = [
  { host: 'chatgpt.com.evil.test', why: 'allowed domain used as a prefix of another domain' },
  { host: 'evilchatgpt.com', why: 'allowed domain as a suffix without a dot' },
  { host: 'chatgpt-com.evil.test', why: 'look-alike with a dash' },
  { host: 'sub.chatgpt.com', why: 'unknown subdomain of the allowed app' },
  { host: 'foo.gemini.google.com', why: 'unknown subdomain of a blocked app' },
];

test.describe('Domain matching (BND-01)', () => {
  test.beforeEach(async ({ context }) => {
    const pattern = new RegExp(`^https://(${FAKE_HOSTS.map((h) => h.host.replace(/\./g, '\\.')).join('|')})/`);
    await context.route(pattern, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>placeholder</title><h1>placeholder</h1>' }),
    );
  });

  for (const { host, why } of FAKE_HOSTS) {
    test(`${host} (${why}) is not treated as a known GenAI app`, async ({ page, ruleMock, decisions }) => {
      await visit(page, `https://${host}/`);
      await expectUntouched(page, host);
      expect(ruleMock.requests, `${host} should not be sent for evaluation`).toEqual([]);
      expect(decisions, `${host} should not get a rule decision`).toEqual([]);
    });
  }

  test('the real allowed and blocked hosts are evaluated under their exact hostname', async ({
    context,
    page,
    ruleMock,
  }) => {
    await visit(page, 'https://chatgpt.com/');
    await visit(await context.newPage(), 'https://gemini.google.com/');
    await expect.poll(() => [...new Set(ruleMock.requests)].sort(), { timeout: 15_000 }).toEqual([
      'chatgpt.com',
      'gemini.google.com',
    ]);
  });
});

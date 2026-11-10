# GenAI Extension Automation

[![Extension E2E](https://github.com/giladsharify/genai-extension-automation/actions/workflows/e2e.yml/badge.svg)](https://github.com/giladsharify/genai-extension-automation/actions/workflows/e2e.yml)

Automated tests that check the **Prompt Security browser extension** enforces this administrator policy:

- **Allow** `chatgpt.com`
- **Block** every other GenAI app, for example `gemini.google.com`

Built with **Playwright + TypeScript**. Runs locally and in GitHub Actions.

## Quick start

Requirements: Node.js 22.18+ (runs `.ts` files directly) and macOS, Linux or Windows.

```bash
npm ci
npx playwright install chromium
cp .env.example .env          # then put the API key in .env
npm test                      # downloads the extension on first run, then runs every test
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run test:headed` | Run with a visible browser window |
| `npx playwright test --project=enforcement` | Only the controlled-policy tests |
| `npx playwright test --project=live` | Only the tests against the real Prompt Security backend |
| `npm run report` | Open the HTML report of the last run |
| `npm run fetch-extension -- --force` | Re-download the latest extension from the Chrome Web Store |

## How it works

1. **Get the extension.** [scripts/fetch-extension.ts](scripts/fetch-extension.ts) downloads the extension (`.crx`) from the Chrome Web Store and unpacks it into `extension/`. It isn't committed, so this repo doesn't redistribute Prompt Security's code. If `extension/` already exists, it is used as is, so you can also drop in a local copy.
2. **Load it.** Each test starts a fresh Chromium profile with `--load-extension` ([src/fixtures.ts](src/fixtures.ts)).
3. **Configure it like a user would.** The fixture opens the extension's popup, enters the API domain and key, and waits until the settings are saved in the extension's storage. It then waits until every config sync ("heartbeat") with the backend has finished and the backend traffic has been quiet for a second. Saving can start more than one sync at once, and until they are done the extension doesn't know which sites are GenAI apps.
4. **Visit sites and check the result.**
   - **Blocked:** the extension redirects the tab to `chrome-extension://<id>/html/pageOverlay.html?…&type=blockPage`. The test checks that URL, the "Access Denied" title, the blocked domain in the message, and that no bypass button is offered ([src/pages/BlockPage.ts](src/pages/BlockPage.ts)).
   - **Allowed:** the test waits until the extension has actually made its decision for the domain (read from the extension's service-worker log), checks the decision isn't `Block`, and checks the tab stays on the site ([src/assertions.ts](src/assertions.ts)). So "not blocked" never just means "the extension hadn't got to it yet".

### Two test projects

For each GenAI domain, the extension asks the Prompt Security backend what to do (`POST /api/employee/evaluate-rule`), and the backend answers with an action (`Block`, `Protect`, …).

| Project | Backend rule answer | Purpose |
| --- | --- | --- |
| `enforcement` | **Intercepted** and replaced by the policy in [src/policy.ts](src/policy.ts) (allow `chatgpt.com`, block every other GenAI domain). Everything else (heartbeat, config, assets) goes to the real backend. | Deterministic check that the extension enforces whatever the admin configures |
| `live` | Real backend, no interception | End-to-end check of the actual tenant configuration |

The interception uses Playwright's `context.route()`. Requests from the extension's service worker can be intercepted with `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, which is set in [playwright.config.ts](playwright.config.ts). As a safeguard, a mocked test fails if the extension made decisions without the mock ever being hit, so it can never pass silently against the real backend.

CI doesn't record Playwright traces, because traces contain the typed API key and the repo's artifacts are public. Locally, traces are kept for failed tests.

### Known issue: the live tenant doesn't block Gemini

As of 2026-11-10, the backend tenant for the provided API key returns `Protect` (allow + inspect) for **every** GenAI domain, including `gemini.google.com`. So Gemini isn't actually blocked. The live Gemini test first requires the extension to evaluate Gemini with the live backend. Only when the backend's answer is something other than `Block` is the test marked as an expected failure (`test.fail`) with this explanation. Any other failure (backend unreachable, wrong key, no decision) still fails the run. If the tenant gets fixed, the test simply passes.

## Test scenarios

| Area | Scenarios |
| --- | --- |
| Setup | Extension loads and its service worker starts; popup saves domain and key; heartbeat with the backend returns 200 |
| Positive (allowed) | `chatgpt.com`, a ChatGPT deep link |
| Negative (blocked) | Gemini (root and deep link), Perplexity, DeepSeek, Mistral; block page doesn't offer a bypass |
| Navigation | Allowed → blocked in the same tab; blocked app in a new tab; still blocked on a second visit; non-GenAI site isn't evaluated or blocked |
| Control | No extension → Gemini loads; extension installed but not configured → nothing evaluated or blocked |
| Live | ChatGPT allowed; Gemini blocked (expected failure, see above) |

Blocked and allowed apps are data-driven from [src/policy.ts](src/policy.ts). To cover another app, add a line there.

## CI

[.github/workflows/e2e.yml](.github/workflows/e2e.yml) runs on every push to `main`, on pull requests and on manual dispatch:

1. install dependencies and Chromium
2. download the extension
3. type-check
4. run the tests

The **list reporter output in the "Run tests" step is the test-suite printout**. The workflow also writes a results table to the job summary and uploads the HTML report as an artifact. On failure it uploads traces, screenshots and videos.

The API domain and key come from the repository secrets `PS_API_DOMAIN` and `PS_API_KEY`.

## Project layout

```
scripts/fetch-extension.ts   download + unpack the extension
scripts/junit-summary.ts     JUnit XML → GitHub job summary
src/fixtures.ts              browser-with-extension fixtures, rule interception, decision log
src/policy.ts                the policy under test + test data
src/assertions.ts            allowed / untouched assertions
src/pages/                   page objects: extension popup, block page
tests/enforcement/           controlled-policy tests
tests/live/                  real-backend tests
```

## Limitations and next steps

- **Third-party sites.** ChatGPT, Claude and others often show a Cloudflare bot check to automated browsers. The tests check the *extension's* behavior (its decision and the tab URL), not that the site's UI loaded, so a bot check doesn't affect the result.
- **Internal log signal.** "Decision made" and "sync finished" are read from the extension's service-worker log. That's reliable today, but it's internal. A test hook or a status API from the extension would be more stable.
- **Ideas for more coverage:**
  - managed-policy configuration (Chrome enterprise policy, see the extension's `schema.json`) instead of the popup
  - Microsoft Edge
  - checking the block event is reported to the backend (`send-block-log`)
  - a nightly scheduled run of the live suite

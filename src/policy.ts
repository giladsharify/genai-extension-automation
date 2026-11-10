/**
 * The administrator policy under test (from the assignment):
 *   - Allow chatgpt.com
 *   - Block every other GenAI app (e.g. gemini.google.com)
 */
export const POLICY = {
  allowedDomains: ['chatgpt.com'],
} as const;

/** GenAI apps the policy must block. Used to drive data-driven tests. */
export const BLOCKED_GENAI_APPS = [
  { name: 'Gemini', url: 'https://gemini.google.com/' },
  { name: 'Gemini (deep link)', url: 'https://gemini.google.com/app' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { name: 'Mistral Le Chat', url: 'https://chat.mistral.ai/' },
] as const;

/** URLs of the allowed GenAI app. */
export const ALLOWED_GENAI_APPS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'ChatGPT (deep link)', url: 'https://chatgpt.com/?model=auto' },
] as const;

/** The action the extension's backend uses for each policy decision. */
export type RuleAction = 'Block' | 'Protect';

export function normalizeDomain(domain: string): string {
  return domain.replace(/^www\./, '').toLowerCase();
}

export function isAllowed(domain: string): boolean {
  const d = normalizeDomain(domain);
  return POLICY.allowedDomains.some((a) => d === a || d.endsWith(`.${a}`));
}

/** What the admin console would return for this domain under our policy. */
export function ruleActionFor(domain: string): RuleAction {
  return isAllowed(domain) ? 'Protect' : 'Block';
}

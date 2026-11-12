/**
 * Turns Playwright's JUnit XML into a Markdown table for the GitHub job summary.
 * Usage: node scripts/junit-summary.ts test-results/junit.xml >> "$GITHUB_STEP_SUMMARY"
 */
import { existsSync, readFileSync } from 'node:fs';
import { installedExtensionVersion } from '../src/extension.ts';

const file = process.argv[2] ?? 'test-results/junit.xml';
if (!existsSync(file)) {
  console.log(`No test results found at \`${file}\`.`);
  process.exit(0);
}
const xml = readFileSync(file, 'utf8');

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => decode(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '');

const rows: string[] = [];
let passed = 0;
let failed = 0;
let skipped = 0;

for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
  const [, attrs, , body = ''] = m;
  const name = attr(attrs, 'name');
  const suite = attr(attrs, 'classname');
  const time = Number(attr(attrs, 'time')).toFixed(1);
  let status = '✅ passed';
  if (/<(failure|error)\b/.test(body)) {
    status = '❌ failed';
    failed++;
  } else if (/<skipped\b/.test(body)) {
    status = '⏭️ skipped';
    skipped++;
  } else {
    passed++;
  }
  if (/expected to fail|Known issue/i.test(body)) status += ' (expected failure)';
  rows.push(`| ${status} | ${suite} | ${name.replace(/\|/g, '\\|')} | ${time}s |`);
}

console.log('## Extension allow/block test results\n');
console.log(`**${passed} passed, ${failed} failed, ${skipped} skipped** · extension v${installedExtensionVersion() ?? 'unknown'}\n`);
console.log('| Result | File | Test | Time |');
console.log('| --- | --- | --- | --- |');
console.log(rows.join('\n'));

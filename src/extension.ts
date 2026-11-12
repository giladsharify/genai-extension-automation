import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where the unpacked extension lives (downloaded by scripts/fetch-extension.ts, not committed). */
export const EXTENSION_PATH = resolve(import.meta.dirname, '..', 'extension');

/**
 * The extension version these tests were written and verified against.
 * Several tests pin this version's behavior (fail-open on outages, the 5 s rule
 * timeout, exact-hostname matching, block page selectors). When the Chrome Web
 * Store serves a newer version, the download fails on purpose: run the suite
 * against it with ALLOW_ANY_EXTENSION_VERSION=1, review the differences, then
 * update this value.
 */
export const EXPECTED_EXTENSION_VERSION = '7.1.89';

/** Version of the unpacked extension in EXTENSION_PATH, or null if it isn't there. */
export function installedExtensionVersion(): string | null {
  const manifest = join(EXTENSION_PATH, 'manifest.json');
  if (!existsSync(manifest)) return null;
  return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
}

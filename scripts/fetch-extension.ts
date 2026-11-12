/**
 * Downloads the Prompt Security extension from the Chrome Web Store and
 * unpacks it into ./extension, so tests can load it with --load-extension.
 *
 * The Web Store only serves the latest version, so the script checks it against
 * EXPECTED_EXTENSION_VERSION (src/extension.ts) and fails if they differ. That
 * way a new extension release shows up as a clear message, not as random test
 * failures. Set ALLOW_ANY_EXTENSION_VERSION=1 to test a new version anyway.
 *
 * Usage: npm run fetch-extension            (skips if the expected version is already present)
 *        npm run fetch-extension -- --force (always re-download)
 */
import AdmZip from 'adm-zip';
import { rmSync } from 'node:fs';
import { EXPECTED_EXTENSION_VERSION, EXTENSION_PATH, installedExtensionVersion } from '../src/extension.ts';

const EXTENSION_ID = 'iidnankcocecmgpcafggbgbmkbcldmno';
const CRX_URL =
  'https://clients2.google.com/service/update2/crx?response=redirect' +
  '&prodversion=158.0&acceptformat=crx2,crx3' +
  `&x=id%3D${EXTENSION_ID}%26uc`;
const allowAnyVersion = process.env.ALLOW_ANY_EXTENSION_VERSION === '1';

/** A CRX file is a small header followed by a regular zip archive. */
function crxToZip(crx: Buffer): Buffer {
  if (crx.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('Downloaded file is not a CRX (missing "Cr24" magic)');
  }
  const version = crx.readUInt32LE(4);
  if (version === 3) {
    const headerSize = crx.readUInt32LE(8);
    return crx.subarray(12 + headerSize);
  }
  if (version === 2) {
    const keyLength = crx.readUInt32LE(8);
    const sigLength = crx.readUInt32LE(12);
    return crx.subarray(16 + keyLength + sigLength);
  }
  throw new Error(`Unsupported CRX version: ${version}`);
}

function checkVersion(version: string | null): void {
  if (version === EXPECTED_EXTENSION_VERSION) return;
  const msg =
    `Extension version is v${version}, but the tests are written for v${EXPECTED_EXTENSION_VERSION}. ` +
    'Run the suite with ALLOW_ANY_EXTENSION_VERSION=1, review any differences, ' +
    'then update EXPECTED_EXTENSION_VERSION in src/extension.ts.';
  if (!allowAnyVersion) throw new Error(msg);
  console.warn(`WARNING: ${msg}`);
}

async function main() {
  const force = process.argv.includes('--force');
  const installed = installedExtensionVersion();

  if (!force && installed && (installed === EXPECTED_EXTENSION_VERSION || allowAnyVersion)) {
    checkVersion(installed);
    console.log(`Extension already present (v${installed}) at ${EXTENSION_PATH}`);
    return;
  }
  if (installed && installed !== EXPECTED_EXTENSION_VERSION) {
    console.log(`Local extension is v${installed}, expected v${EXPECTED_EXTENSION_VERSION}. Downloading again.`);
  }

  console.log('Downloading extension from the Chrome Web Store...');
  const res = await fetch(CRX_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const crx = Buffer.from(await res.arrayBuffer());

  rmSync(EXTENSION_PATH, { recursive: true, force: true });
  new AdmZip(crxToZip(crx)).extractAllTo(EXTENSION_PATH, true);

  const version = installedExtensionVersion();
  console.log(`Unpacked extension v${version} to ${EXTENSION_PATH}`);
  checkVersion(version);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

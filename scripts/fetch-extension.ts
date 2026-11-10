/**
 * Downloads the Prompt Security extension from the Chrome Web Store and
 * unpacks it into ./extension, so tests can load it with --load-extension.
 *
 * Usage: npm run fetch-extension            (skips if already present)
 *        npm run fetch-extension -- --force (always re-download)
 */
import AdmZip from 'adm-zip';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXTENSION_ID = 'iidnankcocecmgpcafggbgbmkbcldmno';
const OUT_DIR = resolve(import.meta.dirname, '..', 'extension');
const CRX_URL =
  'https://clients2.google.com/service/update2/crx?response=redirect' +
  '&prodversion=158.0&acceptformat=crx2,crx3' +
  `&x=id%3D${EXTENSION_ID}%26uc`;

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

async function main() {
  const force = process.argv.includes('--force');
  const manifestPath = join(OUT_DIR, 'manifest.json');

  if (!force && existsSync(manifestPath)) {
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`Extension already present (v${version}) at ${OUT_DIR}`);
    return;
  }

  console.log('Downloading extension from the Chrome Web Store...');
  const res = await fetch(CRX_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const crx = Buffer.from(await res.arrayBuffer());

  rmSync(OUT_DIR, { recursive: true, force: true });
  new AdmZip(crxToZip(crx)).extractAllTo(OUT_DIR, true);

  const { version } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(`Unpacked extension v${version} to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

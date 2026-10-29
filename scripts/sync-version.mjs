import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(root, relativePath), 'utf8'),
  );
}

function writeJson(relativePath, data) {
  fs.writeFileSync(
    path.join(root, relativePath),
    `${JSON.stringify(data, null, 2)}\n`,
  );
}

const { version } = readJson('package.json');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Expected a numeric x.y.z version, received: ${version}`);
}

const manifests = [
  'manifests/base.json',
  'manifests/chromium.json',
  'manifests/firefox.json',
];

for (const file of manifests) {
  const manifest = readJson(file);
  manifest.version = version;
  writeJson(file, manifest);
  console.log(`${file}: ${version}`);
}

const lockPath = path.join(root, 'package-lock.json');

if (fs.existsSync(lockPath)) {
  const lock = readJson('package-lock.json');

  lock.version = version;

  if (lock.packages?.['']) {
    lock.packages[''].version = version;
  }

  writeJson('package-lock.json', lock);
  console.log(`package-lock.json (root package): ${version}`);
}
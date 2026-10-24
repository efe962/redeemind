import { access, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const archive = resolve(root, 'redeemind-chromium.zip');
const temporaryDirectory = await mkdtemp(join(root, '.chromium-verify-'));

try {
  await access(archive);
  const powershellArchive = archive.replaceAll("'", "''");
  const powershellDestination = temporaryDirectory.replaceAll("'", "''");
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${powershellArchive}' -DestinationPath '${powershellDestination}' -Force`,
  ]);

  const manifest = join(temporaryDirectory, 'manifest.json');
  await access(manifest);
  for (const requiredFile of [
    'assets/background.js',
    'assets/content.js',
    'src/popup/index.html',
    'assets/popup.js',
  ]) {
    await access(join(temporaryDirectory, requiredFile));
  }

  console.log('Chromium ZIP is valid and has manifest.json at its root.');
} catch (error) {
  if (error.code === 'ENOENT' && error.path === archive) {
    throw new Error(`Chromium ZIP not found: ${archive}`);
  }
  throw new Error(`Chromium ZIP verification failed: ${error.message}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

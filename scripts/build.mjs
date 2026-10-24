import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const target = process.argv[2];
if (target !== 'chromium' && target !== 'firefox') {
  throw new Error('Usage: node scripts/build.mjs <chromium|firefox>');
}

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist', target);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build({
  root,
  build: {
    outDir,
    emptyOutDir: false,
    target: target === 'chromium' ? 'chrome120' : 'es2022',
    rollupOptions: {
      input: {
        background: resolve(root, 'src/background/index.ts'),
        content: resolve(root, 'src/content/index.ts'),
        popup: resolve(root, 'src/popup/index.html'),
        options: resolve(root, 'src/options/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
});
await build({
  root,
  build: {
    outDir,
    emptyOutDir: false,
    target: target === 'chromium' ? 'chrome120' : 'es2022',
    rollupOptions: {
      input: resolve(root, 'src/content/index.ts'),
      output: {
        entryFileNames: 'assets/content.js',
        inlineDynamicImports: true,
        format: 'iife',
      },
    },
  },
});
await cp(resolve(root, 'manifests', `${target}.json`), resolve(outDir, 'manifest.json'));
await cp(resolve(root, '_locales'), resolve(outDir, '_locales'), { recursive: true });

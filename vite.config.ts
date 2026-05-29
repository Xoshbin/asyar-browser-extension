import { defineConfig } from 'vite';
import { existsSync } from 'fs';
import { fileURLToPath, URL } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Mirror the launcher's per-subpath SDK alias pattern. The bare `asyar-sdk`
// specifier has no "." entry in the SDK's exports map and must fail at build
// time; only the subpaths are valid. In dev we redirect to the workspace
// source so edits hot-reload; in CI / published-NPM mode the local source
// does not exist and Node resolution falls back to node_modules.
const sdkSrcDir = resolve(__dirname, '../../asyar-sdk/src');
const sdkSubpaths = ['contracts', 'worker', 'view'] as const;
const useLocalSdk = sdkSubpaths.every((sub) =>
  existsSync(resolve(sdkSrcDir, `${sub}.ts`)),
);

const sdkAliases = useLocalSdk
  ? Object.fromEntries(
      sdkSubpaths.map((sub) => [
        `asyar-sdk/${sub}`,
        resolve(sdkSrcDir, `${sub}.ts`),
      ]),
    )
  : {};

export default defineConfig(() => ({
  // Relative asset paths so the Rust `asyar-extension://` scheme handler can
  // serve `./worker.js` / `./assets/*` from the install path.
  base: './',

  resolve: {
    alias: sdkAliases,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        worker: resolve(__dirname, 'worker.html'),
        view: resolve(__dirname, 'view.html'),
      },
      output: {
        // Deterministic, hash-free entry name so worker.html loads `./worker.js`.
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));

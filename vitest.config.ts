import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath, URL } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const sdkSrcDir = resolve(__dirname, '../../asyar-sdk/src');

export default defineConfig({
  // `svelteTesting()` adds the `browser` resolve condition so the svelte
  // plugin compiles the client (DOM) build for component tests rather than
  // the SSR build (otherwise `mount()` is unavailable on the server).
  plugins: [svelte({ hot: false }), svelteTesting()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: /^asyar-sdk\/contracts$/, replacement: resolve(sdkSrcDir, 'contracts.ts') },
      { find: /^asyar-sdk\/worker$/, replacement: resolve(sdkSrcDir, 'worker.ts') },
      { find: /^asyar-sdk\/view$/, replacement: resolve(sdkSrcDir, 'view.ts') },
    ],
  },
});

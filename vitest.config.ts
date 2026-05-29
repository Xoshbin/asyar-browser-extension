import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const sdkSrcDir = resolve(__dirname, '../../asyar-sdk/src');

export default defineConfig({
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

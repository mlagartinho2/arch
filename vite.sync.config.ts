import { defineConfig } from 'vite';

// Bundles the optional CI wiki-sync job into one dependency-free Node script.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'scripts/sync-standards-wiki.ts',
    outDir: 'dist-sync',
    target: 'node18',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'sync-standards-wiki.mjs' } },
  },
});

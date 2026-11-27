import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // The editor (CodeMirror with Markdown and its embedded HTML/CSS/JS grammars) is a separate, cacheable chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (/node_modules\/(@codemirror|@lezer|crelt|style-mod|w3c-keyname)\//.test(id) ? 'editor' : /node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
  test: { environment: 'node' },
} as any);

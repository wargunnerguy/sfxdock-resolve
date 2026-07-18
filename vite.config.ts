import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: 'src/renderer',
    base: './',
    plugins: [svelte({ configFile: path.resolve(repoRoot, 'svelte.config.js') })],
    build: {
        // Resolve 21 ships Electron 36 (Chromium 136) — see docs/phase0-audit.md §4.
        target: 'chrome136',
        outDir: path.resolve(repoRoot, 'plugin/renderer'),
        emptyOutDir: true,
    },
});

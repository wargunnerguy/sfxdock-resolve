// Builds the deployable plugin folder at plugin/:
//   main.js + preload.js (esbuild), renderer/ (vite+svelte), manifest.xml,
//   WorkflowIntegration.node (copied from the local Resolve installation —
//   Blackmagic's binary is never committed to this repo).

import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'plugin');

const NATIVE_MODULE_SOURCE =
    'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Workflow Integrations\\Examples\\SamplePlugin\\WorkflowIntegration.node';

export async function buildAll() {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    await esbuild({
        entryPoints: [path.join(repoRoot, 'src/main/main.ts')],
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'cjs',
        outfile: path.join(pluginDir, 'main.js'),
        external: ['electron', './WorkflowIntegration.node'],
    });

    await esbuild({
        entryPoints: [path.join(repoRoot, 'src/main/preload.ts')],
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'cjs',
        outfile: path.join(pluginDir, 'preload.js'),
        external: ['electron'],
    });

    await viteBuild({ configFile: path.join(repoRoot, 'vite.config.ts') });

    fs.copyFileSync(path.join(repoRoot, 'assets/manifest.xml'), path.join(pluginDir, 'manifest.xml'));

    if (process.platform === 'win32') {
        if (!fs.existsSync(NATIVE_MODULE_SOURCE)) {
            throw new Error(
                `WorkflowIntegration.node not found at:\n  ${NATIVE_MODULE_SOURCE}\n` +
                    'Is DaVinci Resolve Studio installed? The native module is copied from the local installation.',
            );
        }
        fs.copyFileSync(NATIVE_MODULE_SOURCE, path.join(pluginDir, 'WorkflowIntegration.node'));
    } else {
        throw new Error('Non-Windows build path not implemented yet (macOS lands with Phase 7 packaging).');
    }

    fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify(
            {
                name: 'sfxdock',
                version: '0.1.0',
                description: 'SFXDock — sound effects search for DaVinci Resolve Studio',
                main: 'main.js',
            },
            null,
            2,
        ),
    );

    console.log(`Built plugin folder: ${pluginDir}`);
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    buildAll().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

// Builds and installs the plugin into Resolve's Workflow Integration Plugins
// directory. Resolve scans that directory at startup only, so a full Resolve
// restart is needed after installing (Phase 0 finding).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './build.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'plugin');

const PLUGINS_ROOT =
    'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins';
const target = path.join(PLUGINS_ROOT, 'SFXDock');

await buildAll();

if (!fs.existsSync(PLUGINS_ROOT)) {
    fs.mkdirSync(PLUGINS_ROOT, { recursive: true });
}

try {
    fs.rmSync(target, { recursive: true, force: true });
} catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
        console.error(
            `Cannot replace ${target} — a file is locked.\n` +
                'A lingering SFXDock electron.exe process is probably holding WorkflowIntegration.node.\n' +
                'Close the SFXDock window (or kill the electron.exe processes under the Resolve install path — NOT Resolve.exe) and retry.',
        );
        process.exit(1);
    }
    throw e;
}

fs.cpSync(pluginDir, target, { recursive: true });

console.log(`Installed: ${target}`);
console.log('Now fully restart DaVinci Resolve, then open Workspace > Workflow Integrations > SFXDock.');

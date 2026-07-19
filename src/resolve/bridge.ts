// The ONLY module in the codebase that touches WorkflowIntegration.node
// (CLAUDE.md architecture rule). Everything else talks to this bridge and
// must keep working when Resolve is absent (connect() simply fails).

import type {
    ImportResult,
    ProjectSnapshot,
    ResolveApp,
    ResolveFolder,
    WorkflowIntegrationModule,
} from './types';

// Resolved at runtime relative to the bundled plugin/main.js, where the
// build script places the native module. Kept external in the esbuild config.
const NATIVE_MODULE = './WorkflowIntegration.node';

export class ResolveBridge {
    private wi: WorkflowIntegrationModule | null = null;
    private resolveApp: ResolveApp | null = null;

    productName: string | null = null;
    resolveVersion: string | null = null;
    lastError: string | null = null;

    get connected(): boolean {
        return this.resolveApp !== null;
    }

    async connect(pluginId: string): Promise<boolean> {
        if (this.resolveApp) return true;
        try {
            this.wi ??= require(NATIVE_MODULE) as WorkflowIntegrationModule;
            const initialized = await this.wi.Initialize(pluginId);
            if (!initialized) {
                this.lastError = 'Initialize() returned false — is DaVinci Resolve Studio running?';
                return false;
            }
            // API calls block while Resolve shows a modal dialog; never hang forever
            // (Phase 0 finding, docs/phase0-audit.md §3.7).
            await this.wi.SetAPITimeout(10);
            const resolveApp = await this.wi.GetResolve();
            if (!resolveApp) {
                this.lastError = 'GetResolve() returned no Resolve object';
                return false;
            }
            this.resolveApp = resolveApp;
            this.productName = await resolveApp.GetProductName();
            this.resolveVersion = await resolveApp.GetVersionString();
            this.lastError = null;
            return true;
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            return false;
        }
    }

    onResolveQuit(cb: () => void): void {
        void this.wi?.RegisterCallback('ResolveQuit', cb);
    }

    // Project identity must be polled — Resolve has no project-change events
    // (Phase 0 finding, docs/phase0-audit.md §3.6).
    async snapshot(): Promise<ProjectSnapshot | null> {
        if (!this.resolveApp) return null;
        try {
            const pm = await this.resolveApp.GetProjectManager();
            const project = pm ? await pm.GetCurrentProject() : null;
            if (!project) return { projectName: null, projectId: null };
            return {
                projectName: await project.GetName(),
                projectId: await project.GetUniqueId(),
            };
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            return null;
        }
    }

    // Imports a file into a Media Pool bin (created if missing — bins can't be
    // renamed via API, so the configured name is matched/created, not renamed).
    // Uses exactly the calls the Phase 0 probe verified.
    async importToBin(filePath: string, binName: string): Promise<ImportResult> {
        if (!this.resolveApp) return { ok: false, binName, error: 'Not connected to Resolve' };
        try {
            const pm = await this.resolveApp.GetProjectManager();
            const project = pm ? await pm.GetCurrentProject() : null;
            const mediaPool = project ? await project.GetMediaPool() : null;
            const root = mediaPool ? await mediaPool.GetRootFolder() : null;
            if (!mediaPool || !root) return { ok: false, binName, error: 'No open project / media pool' };

            let bin: ResolveFolder | null = null;
            for (const sub of await root.GetSubFolderList()) {
                if ((await sub.GetName()) === binName) {
                    bin = sub;
                    break;
                }
            }
            bin ??= await mediaPool.AddSubFolder(root, binName);
            if (!bin) return { ok: false, binName, error: `Could not create bin "${binName}"` };

            await mediaPool.SetCurrentFolder(bin);
            const items = await mediaPool.ImportMedia([filePath]);
            if (!items || items.length === 0) {
                return { ok: false, binName, error: 'Resolve did not import the file' };
            }
            return { ok: true, binName, clipName: await items[0]!.GetName() };
        } catch (e) {
            return { ok: false, binName, error: e instanceof Error ? e.message : String(e) };
        }
    }

    // NOTE: deliberately no cleanup()/CleanUp() call anywhere. Blackmagic's
    // docs say to call WorkflowIntegration.CleanUp() on quit, but on Resolve
    // 21 (module v2.0.0) it blocks the main thread forever and leaks the
    // process (verified 2026-07-19). Plain process exit is safe.
}

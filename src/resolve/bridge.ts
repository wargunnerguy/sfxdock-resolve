// The ONLY module in the codebase that touches WorkflowIntegration.node
// (CLAUDE.md architecture rule). Everything else talks to this bridge and
// must keep working when Resolve is absent (connect() simply fails).

import type {
    ProjectSnapshot,
    ResolveApp,
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

    cleanup(): void {
        try {
            this.wi?.CleanUp();
        } catch {
            // best effort on shutdown
        }
        this.resolveApp = null;
    }
}

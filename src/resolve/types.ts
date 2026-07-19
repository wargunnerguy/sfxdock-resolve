// Typed subset of the WorkflowIntegration native module and the Resolve object
// tree, limited to what SFXDock actually calls. Extend as later phases need
// more surface; the full verified enumeration is in docs/phase0-audit.md §3.4.
//
// All Resolve calls are typed as Promise-returning: in the Workflow
// Integration context the bridge marshals across processes and the sample
// code awaits every call.

export interface WorkflowIntegrationModule {
    GetInfo(): Promise<{ version: string }>;
    Initialize(pluginId: string): Promise<boolean>;
    GetResolve(): Promise<ResolveApp | null>;
    RegisterCallback(name: string, cb: () => void): Promise<boolean>;
    DeregisterCallback(name: string): Promise<boolean>;
    CleanUp(): boolean;
    SetAPITimeout(seconds: number): Promise<boolean>;
}

export interface ResolveApp {
    GetProductName(): Promise<string>;
    GetVersionString(): Promise<string>;
    GetProjectManager(): Promise<ProjectManager | null>;
}

export interface ProjectManager {
    GetCurrentProject(): Promise<ResolveProject | null>;
}

export interface ResolveProject {
    GetName(): Promise<string>;
    GetUniqueId(): Promise<string>;
    GetMediaPool(): Promise<MediaPool | null>;
}

export interface MediaPool {
    GetRootFolder(): Promise<ResolveFolder | null>;
    AddSubFolder(parent: ResolveFolder, name: string): Promise<ResolveFolder | null>;
    SetCurrentFolder(folder: ResolveFolder): Promise<boolean>;
    ImportMedia(paths: string[]): Promise<MediaPoolItem[] | null>;
}

export interface ResolveFolder {
    GetName(): Promise<string>;
    GetSubFolderList(): Promise<ResolveFolder[]>;
}

export interface MediaPoolItem {
    GetName(): Promise<string>;
}

export interface ProjectSnapshot {
    projectName: string | null;
    projectId: string | null;
}

export interface ImportResult {
    ok: boolean;
    binName: string;
    clipName?: string;
    error?: string;
}

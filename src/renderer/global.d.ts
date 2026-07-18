import type { SfxdockApi } from '../shared/ipc';

declare global {
    interface Window {
        // Absent when the renderer runs outside the plugin shell (vite dev in a browser).
        sfxdock?: SfxdockApi;
    }
}

export {};

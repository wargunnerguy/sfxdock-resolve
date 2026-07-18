# Phase 0 — Environment Audit

Date: 2026-07-19. Machine: Reimo's Windows workstation. Auditor: Claude Code, with GUI steps performed by Reimo.

Every claim below is tagged:

- **[V]** — verified on this machine (command output, probe plugin run inside Resolve, or visually confirmed by Reimo in the Resolve GUI).
- **[D]** — stated in Blackmagic's documentation but not independently verified here.

The API probe plugin used in Step 4 lives at `scratch/sample-probe/` (never committed; `scratch/` is gitignored). Its raw output is `scratch/probe-report.json` and `scratch/probe-cleanup.json`.

---

## CLAUDE.md corrections needed

No Phase 0 finding contradicts a locked product fact in CLAUDE.md. The Sound Library assumption (no API) is now positively confirmed. Three assumptions are *resolved or sharpened* and are reflected in the CLAUDE.md update accompanying this report:

1. **Electron bundling model resolved: plugins do not ship Electron at all.** Resolve installs and launches its own Electron runtime (`C:\Program Files\Blackmagic Design\DaVinci Resolve\Electron\electron.exe`, v36.3.2) **[V]**. The feared "Electron-version-locked native module" problem mostly dissolves: `WorkflowIntegration.node` is a Node-API (N-API) module (exports `node_api_module_get_api_version_v1`) **[V]**, so it is ABI-stable, and the runtime is Resolve's problem, not ours. The pin matters for *our dev tooling and our own native dependencies* (see Toolchain constraints), not for distribution.
2. **"Floating pinnable window" is our job, not a platform feature.** The plugin window is an ordinary OS-level Electron window: floats over Resolve, taskbar entry, can go behind Resolve, survives project switching **[V]** (Reimo, GUI). There is no built-in "pin"; SFXDock must implement pinning itself (`BrowserWindow.setAlwaysOnTop`).
3. **Configurable bin name means "create", never "rename".** `Folder` has no `SetName` — probed `typeof` is `undefined` **[V]**. If the user changes the bin name in settings, SFXDock creates/uses a bin with the new name; it cannot rename the old one via API.

---

## 1. Environment summary

| Item | Value | Status |
|---|---|---|
| OS | Windows 11 Pro, build 10.0.26200 (25H2). Note: `Get-ComputerInfo` misreports the marketing name as "Windows 10 Pro"; build 26200 is Windows 11. | [V] |
| Resolve edition | **DaVinci Resolve Studio** — confirmed two ways: Reimo via About dialog, and programmatically: `resolve.GetProductName()` → `"DaVinci Resolve Studio"` | [V] |
| Resolve version | 21.0.0.48 (`Resolve.exe` metadata; `GetVersionString()` → `"21.0.0.48"`) — satisfies the Studio 19+ requirement | [V] |
| Workflow Integration Plugins dir | `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\` — **did not exist** before this audit (no plugin ever installed); created during Step 3; Resolve scans it at startup | [V] |
| Developer material | `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\` — README.txt (24 KB, updated 2024-10-03), CHANGELOG.txt (updated 2025-07-28), `Examples/` with **four** Electron sample plugins (SamplePlugin, SamplePromisePlugin, CompatibleSamplePlugin, ScriptTestPlugin) + two Python script examples, `Scripts/` with seven JS API scripts incl. `AddBinsAndClipsToMediaPool.js` | [V] |
| Scripting docs | `...\Support\Developer\Scripting\README.txt` (113 KB) — authoritative API reference, shared by scripts and Workflow Integrations | [V] |
| Bundled Electron | `C:\Program Files\Blackmagic Design\DaVinci Resolve\Electron\electron.exe` v36.3.2 | [V] |
| Node.js (system) | v24.15.0, npm 11.12.1, pnpm 11.3.0, no yarn | [V] |
| Node.js (plugin runtime) | 22.15.1 — from `process.versions` inside the running plugin | [V] |

## 2. Plugin packaging requirements

### 2.1 Manifest (`manifest.xml`)

All four samples use the identical minimal schema **[V]**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<BlackmagicDesign>
    <Plugin>
        <Id>com.blackmagicdesign.resolve.sampleplugin</Id>
        <Name>Sample Plugin</Name>
        <Version>1.0</Version>
        <Description>Sample Plugin</Description>
        <FilePath>main.js</FilePath>
    </Plugin>
</BlackmagicDesign>
```

| Field | Meaning |
|---|---|
| `Id` | Unique plugin id, reverse-DNS style. Must match the string passed to `WorkflowIntegration.Initialize(pluginId)` at runtime — the probe verified init succeeds when they match **[V]**. |
| `Name` | Menu label shown under Workspace > Workflow Integrations **[V]**. |
| `Version` | Plugin version string. Displayed nowhere we observed; presumably informational **[V observed / purpose D]**. |
| `Description` | Informational **[D]**. |
| `FilePath` | Entry point, relative to the plugin folder — the Electron main-process script (`main.js`) **[V]**. Whether absolute/outside-folder paths work is untested (see Open questions). |

No icon, author, or min-version fields appear in any sample; the schema beyond these five fields is undocumented **[V — absence of evidence in all shipped samples and docs]**.

### 2.2 Required layout

Documented structure **[D]**, matching what the samples actually ship **[V]**:

```
<plugins root>\com.<company>.<plugin_name>\
    manifest.xml
    main.js                  (Electron main process; entry point per manifest)
    preload.js               (contextBridge; the only place besides main that can require() native/node modules)
    index.html               (renderer UI)
    renderer.js / css/ img/  (renderer assets)
    package.json             (informational for Resolve; Resolve does not run npm)
    WorkflowIntegration.node (native bridge module — copied into each plugin folder)
    node_modules\            (supported per docs; none of the samples ship any)
```

Plugins root (Windows): `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\` **[V]**; (macOS): `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/` **[D]**.

- The folder name does not need to equal the manifest `Id` — the probe was registered as folder `sample-probe` with id `com.sfxdock.probe` and loaded fine **[V]**.
- Resolve scans the root **at startup only**; a full Resolve restart is required for a newly copied plugin to appear **[V — first scan happened after restart; whether hot-rescan exists elsewhere is untested]**.
- The README's layout listing mentions `package.js`; that is a typo for `package.json` (all samples ship `package.json`) **[V]**.

### 2.3 Electron bundling model

- **Resolve provides the runtime.** Plugins are launched with Resolve's bundled Electron 36.3.2; the running plugin's `process.execPath` is `C:\Program Files\Blackmagic Design\DaVinci Resolve\Electron\electron.exe` **[V]**. Plugins ship JS/HTML/assets plus `WorkflowIntegration.node` only. Our installer must NOT package an Electron runtime.
- **`WorkflowIntegration.node`** (~390 KB) is copied into each plugin folder and loaded from the main process (sandboxed model) or preload (legacy model) via `require('./WorkflowIntegration.node')` — a path relative to the plugin folder **[V]**. It is an N-API module (`node_api_module_get_api_version_v1` export; `process.versions.napi` = 10) **[V]**. Binary strings (`PluginInterfaceVersions`, "Failed to set interface version") indicate a versioned IPC protocol to the Resolve host process — the module is a bridge, not the API implementation itself **[V — strings; interpretation ours]**.
- Blackmagic instructs developers to refresh `WorkflowIntegration.node` from `Examples/SamplePlugin/` when updating **[D]**. The copy in `CompatibleSamplePlugin` differs slightly in size from the other three (397,784 vs 397,680 bytes) — use the SamplePlugin one **[V]**.
- **Process model since 19.0.2 (Electron defaults enforced): sandboxed renderer + context isolation** **[D]**. Recommended (and our) pattern, from SamplePlugin **[V]**: main process owns the native module and all Resolve calls; renderer gets a `contextBridge`-exposed API; communication via `ipcMain.handle`/`ipcRenderer.invoke`. The non-sandboxed CompatibleSamplePlugin pattern (native module required in preload, `nodeIntegration` on) exists only as a migration aid and is explicitly not recommended **[D]**.

### 2.4 Launch chain

Observed/derived chain **[V for observable parts]**:

1. Resolve startup → scans plugins root, parses each `manifest.xml`, adds menu entries under Workspace > Workflow Integrations.
2. User clicks the menu entry → Resolve spawns its bundled `electron.exe` with the plugin folder as the app (the manifest `FilePath` script becomes the Electron main script; `package.json` `main` is not what Resolve reads — manifest is authoritative **[D — README describes manifest-driven load]**).
3. Plugin main process runs like any Electron app: `app.whenReady()` → creates its own `BrowserWindow`, loads `index.html`.
4. The plugin calls `WorkflowIntegration.Initialize(pluginId)` and then `GetResolve()` to obtain the scripting root object; all subsequent API traffic goes through the native module's private channel to the Resolve process.

Plugin windows are independent OS windows (taskbar presence, min/max, can go behind Resolve) and keep running across project switches **[V]**. Multiple plugins can run at the same time **[D, and consistent with our probe running alongside the sample]**.

**Process lifetime caveat:** after the probe session, eight `electron.exe` processes lingered and held a file lock on the probe's `WorkflowIntegration.node` even after the plugin window was reportedly closed; they had to be force-killed before the plugin folder could be deleted **[V]**. Whether this was an unclosed window or a genuine quit bug is unresolved — Phase 1 must verify clean shutdown (window close → `app.quit()` → process exit), since a locked `.node` file breaks plugin updates and uninstalls.

### 2.5 Must the app live inside the plugins directory?

The docs only describe copying the whole plugin folder into the root **[D]**; every sample assumes folder-relative paths **[V]**. Whether manifest `FilePath` accepts an absolute path outside the root **can only be answered empirically** — flagged as an open question. For Phase 1, assume the deployable must be a self-contained folder in the plugins root; the dev-install script copies (or symlinks — also untested) the built folder there.

## 3. Confirmed API surface

### 3.1 Bridge module (`WorkflowIntegration.node`) — all [V]

`GetInfo()` → `{ version: "2.0.0" }`. `Initialize(id)` → `true`. `SetAPITimeout(60)` → `true` (probe set this immediately after init as a hang guard; recommended practice — API calls block while Resolve shows modal dialogs). `GetResolve()` → `Resolve` object. Promise variants (`InitializePromise`, `GetResolvePromise`) exist per docs and SamplePromisePlugin **[D — not exercised]**. `CleanUp()` → true on quit path **[V via sample; probe calls it best-effort]**.

### 3.2 Enumeration technique

`Object.keys(obj)` and `Object.getOwnPropertyNames(obj)` return nothing useful on the native objects (only `uniqueId` on some). **What works: `Object.getOwnPropertyNames(Object.getPrototypeOf(obj))`** — full method lists on every object's prototype **[V]**. `typeof obj.Method` probing also works and was used to cross-check candidates from the scripting README **[V]**.

### 3.3 SFXDock-required calls — pass/fail (all [V], probe run 2026-07-18, inside Resolve Studio 21.0.0.48)

| # | Need | Call | Result |
|---|---|---|---|
| 1 | Current project | `projectManager.GetCurrentProject()` | PASS → Project object |
| 2 | Project name (attribution export context) | `project.GetName()` | PASS → returned the open project's name (incl. non-ASCII characters intact) |
| 3 | Stable project identity | `project.GetUniqueId()` | PASS → GUID string |
| 4 | Media Pool root | `mediaPool.GetRootFolder()` | PASS → Folder, `GetName()` → "Master" |
| 5 | List bins | `rootFolder.GetSubFolderList()` | PASS → array (empty in test project) |
| 6 | Create bin | `mediaPool.AddSubFolder(root, "SFXDock-probe-test")` | PASS → Folder object; visually confirmed in Media Pool |
| 7 | Target bin for import | `mediaPool.SetCurrentFolder(bin)` | PASS → true |
| 8 | Import audio file | `mediaPool.ImportMedia([wav path])` | PASS → 1 MediaPoolItem; visually confirmed in bin |
| 9 | Import audio file (alt path) | `mediaStorage.AddItemListToMediaPool([wav path])` | PASS → 1 MediaPoolItem (imports into *current* folder) |
| 10 | Clip properties | `clip.GetClipProperty('Duration')` / `('File Path')` | PASS → "00:00:01:00" / full path |
| 11 | Rename clip | `clip.SetName(...)` | PASS → true; visually confirmed |
| 12 | Stamp metadata (license/attribution) | `clip.SetMetadata('Keywords', ...)` + `GetMetadata` | PASS → round-tripped |
| 13 | Private metadata namespace | `clip.SetThirdPartyMetadata(...)` + get | PASS → round-tripped |
| 14 | Delete clips (cleanup UX) | `mediaPool.DeleteClips([2 clips])` | PASS → true |
| 15 | Delete bin (cleanup UX) | `mediaPool.DeleteFolders([bin])` | PASS → true; visually confirmed gone |
| 16 | Rename bin | `Folder.SetName` | **FAIL — method does not exist** (bins: create/move/delete only) |
| 17 | Sound Library API | any method matching /sound/i anywhere | **ABSENT (expected)** — see 3.5 |
| 18 | Event hooks | `RegisterCallback(...)` | PARTIAL — see 3.6 |

Also verified: `resolve.GetProductName()`, `GetVersion()`, `GetVersionString()`, `GetCurrentPage()` (→ "cut"), `project.GetTimelineCount()` (→ 0), `project.GetCurrentTimeline()` (→ empty when no timeline exists). The whole probe sequence (init → 40+ calls → report) completed in ~0.7 s.

### 3.4 Full enumerated method lists (prototype inspection, [V])

Complete lists are in `scratch/probe-report.json` (`enumeration` section — regenerate by re-running the probe; summary preserved here since scratch is not committed):

- **Resolve** (29): Fusion, GetProjectManager, GetMediaStorage, OpenPage, GetCurrentPage, GetProductName, GetVersion, GetVersionString, Quit, layout-preset ops (Load/Update/Export/Delete/Save/Import), render/burn-in preset import/export, GetKeyframeMode/SetKeyframeMode, GetFairlightPresets, DisableBackgroundTasksForCurrentResolveSession, plus undocumented: `TriggerCtrKTest`, `SetHighPriority`, `SetSourceViewerMode`/`GetSourceViewerMode`, `SetShowAllVideoFrames`/`GetShowAllVideoFrames`.
- **ProjectManager** (28): all documented project/folder/database/cloud ops; undocumented extras: `GetProjectLastModifiedTime`, plural aliases `GetProjectsInCurrentFolder`, `GetFoldersInCurrentFolder`.
- **Project** (51): everything documented incl. `GetMediaPool`, `GetName`/`SetName`, `GetUniqueId`, `GetSetting`/`SetSetting`, `InsertAudioToCurrentTrackAtPlayhead` (Fairlight playhead insert — possible future SFXDock feature), full render pipeline; undocumented: `GetTimelineFromUniqueId`, `GetPlaybackSpeed`, alias `GetRenderJobs`/`GetPresets`/`GetRenderPresets`.
- **MediaPool** (26): GetRootFolder, AddSubFolder, SetCurrentFolder/GetCurrentFolder, ImportMedia, DeleteClips, DeleteFolders, MoveClips, MoveFolders, RefreshFolders, timeline creation ops, RelinkClips/UnlinkClips, GetSelectedClips/SetSelectedClip, AutoSyncAudio, ExportMetadata, GetUniqueId.
- **Folder** (20): GetName, GetClipList (+alias `GetClips`), GetSubFolderList (+alias `GetSubFolders`), GetUniqueId, GetIsFolderStale, Export, AI ops (TranscribeAudio, PerformAudioClassification, AnalyzeForIntellisearch, ...). **No SetName.**
- **MediaStorage** (11): GetMountedVolumeList, GetSubFolderList, GetFileList, RevealInStorage, AddItemListToMediaPool (+plural aliases), matte ops.
- **MediaPoolItem** (46): GetName/SetName, GetMetadata/SetMetadata, GetThirdPartyMetadata/SetThirdPartyMetadata, GetClipProperty/SetClipProperty, GetMediaId, GetUniqueId, ReplaceClip, LinkProxyMedia, markers/flags/color ops, GetAudioMapping, `MonitorGrowingFile` (undocumented), AI ops.
- **Timeline**: not enumerated — test project had no timeline and `GetCurrentTimeline()` returned empty. Not needed for v1 scope (import lands in a bin; drag-to-timeline is manual). Enumerate opportunistically in Phase 5 if useful.

### 3.5 Sound Library — negative result (confirmed)

- Docs: zero occurrences of "sound library" (case-insensitive) across the entire `Support\Developer` tree (Workflow Integrations README/CHANGELOG, Scripting README/CHANGELOG, all samples) **[V]**.
- Runtime: 194 unique method/property names enumerated across all reachable objects; **0 match /sound/i** **[V]**. Explicit `typeof` probes for `GetSoundLibrary`, `SoundLibrary`, `GetSoundLib`, `OpenSoundLibrary`, `ImportSoundLibrary` on Resolve → all `undefined` **[V]**.

CLAUDE.md's strategy stands: no integration; guide users to add the SFXDock download folder to the Sound Library themselves, and embed searchable metadata in downloaded files.

### 3.6 Callbacks / events

- `RegisterCallback('RenderStart')` → true; `'ResolveQuit'` → true; deregistration works **[V]**. `'RenderStop'` documented **[D — not individually exercised]**.
- Undocumented names `ProjectChanged`, `ProjectOpened`, `ProjectClosed`, `TimelineChanged` all fail with "Failed to register callback with host" **[V]**.
- **Consequence:** there is no push notification for project switches. SFXDock must poll `GetCurrentProject()` → `GetUniqueId()` (cheap: full probe round-trip averaged ~15 ms/call) to keep per-project attribution context current. `ResolveQuit` should be handled for graceful shutdown.

### 3.7 Docs-vs-reality gaps

All documented methods we probed exist and behave as documented — no negative gaps found. Positive gaps (reality > docs), all **[V]**:

1. Undocumented methods and plural aliases exist throughout (listed in 3.4). Do not rely on them; they are unsupported surface.
2. `GetCurrentTimeline()` with no timeline returns an empty value rather than erroring (docs don't specify).
3. Behavioral notes: API calls can block while Resolve shows modal dialogs (CHANGELOG 20.1 note **[D]**) — mitigate with `SetAPITimeout`; verified settable **[V]**.
4. Keyboard-input anomaly: in Blackmagic's SamplePlugin, Reimo could not type into text fields **[V, once]**; in our probe window typing worked normally **[V]**. The sample's inputs are plain HTML with no disabling logic, so this looks transient/focus-related, not systemic — but a search box is SFXDock's core UI, so Phase 1 must include a typing sanity check in the skeleton panel.

## 4. Toolchain constraints

Verified runtime (from `process.versions` inside the plugin) **[V]**:

| Component | Version |
|---|---|
| Electron | **36.3.2** (Resolve-bundled; changes only when Blackmagic updates Resolve — was upgraded in 20.1 per changelog **[D]**) |
| Node.js | **22.15.1** |
| Chromium | 136.0.7103.115 |
| V8 | 13.6.233.10-electron.0 |
| Node ABI (`modules`) | **135** |
| N-API (`napi`) | 10 |
| Bundled SQLite (`node:sqlite`) | 3.49.1 |

Consequences (flagged, not solved here):

- **better-sqlite3** is a classic native module (not N-API): it must be built/prebuilt for **Electron 36 / ABI 135**, via `electron-rebuild` or its published Electron prebuilds, and rebuilt whenever a Resolve update bumps Electron. Risk: a Resolve auto-update silently changing ABI under installed plugins. Mitigations to evaluate in Phase 4: ship multiple prebuilds; or use the runtime's built-in `node:sqlite` (3.49.1 present — but experimental in Node 22 and possibly flag-gated; whether flags can be passed to a Resolve-launched plugin is an open question); or use a WASM SQLite build (ABI-independent, slower). Decision deferred to Phase 4 as CLAUDE.md requires.
- **Vite**: build-time only, unaffected by the runtime pin. Set build target to Chromium 136 / Electron 36 renderer; dev-server HMR inside a Resolve-launched window is untested (open question).
- **Dev/test Node**: system Node is 24.15.0 but the runtime is 22.15.1. CI and local tests should run on Node 22.x to match runtime semantics; pin via `.nvmrc`/`engines`.
- **`WorkflowIntegration.node`** is N-API and forward-stable; always ship the newest copy from `Examples/SamplePlugin/` **[D — BMD instruction]**.
- Electron 36 defaults apply: sandboxed renderer, context isolation on. All Resolve API access from the main process behind typed IPC (this also matches CLAUDE.md's `src/resolve/` isolation rule).

## 5. Open questions

| # | Question | Proposed resolution |
|---|---|---|
| 1 | Can manifest `FilePath` reference a path outside the plugins root (absolute path / junction), enabling dev-symlink workflows? | Phase 1: try (a) absolute `FilePath`, (b) NTFS junction of the plugin folder into the root. Cost: minutes each, needs Resolve restarts. |
| 2 | Do plugin processes reliably exit on window close, and what held the `.node` file lock we hit? | Phase 1: instrument skeleton with quit logging; check process list after close. Affects installer/updater design. |
| 3 | Can we pass Node/Electron flags (e.g. `--experimental-sqlite`) to a Resolve-launched plugin? | Phase 1 quick probe (`NODE_OPTIONS`, manifest experiments). Determines whether `node:sqlite` is a viable better-sqlite3 replacement (final decision Phase 4). |
| 4 | Is the SamplePlugin keyboard-input failure reproducible, and under what focus conditions? | Phase 1: typing check in skeleton panel on both fresh launch and after Resolve page switches. |
| 5 | macOS: plugins root path, Electron version parity, packaging/signing behavior | Requires a Mac with Resolve Studio; defer to Phase 7 (packaging) at latest, ideally earlier via a contributor's machine. |
| 6 | Does Resolve rescan plugins without a full restart (menu refresh, project reload)? | Phase 1: empirical check during dev-install script work. |
| 7 | Behavior under Resolve free edition (menu absent vs. load error) — matters for support docs only | Low priority; ask a free-edition user or test in a VM. |
| 8 | `AddItemListToMediaPool` vs `ImportMedia` differences (dedupe behavior, return values on re-import of same file) | Phase 5, when import UX is built; both verified working for the basic case. |

## 6. Implications for Phase 1

**Copy verbatim from SamplePlugin:**

- `manifest.xml` schema exactly as-is (our values: id `com.sfxdock.resolve` or similar; `FilePath` → `main.js`).
- `WorkflowIntegration.node` from `Examples/SamplePlugin/` (the designated latest copy), placed in the plugin folder root, required as `./WorkflowIntegration.node` from the main process.
- The sandboxed process pattern: main process owns the native module + all Resolve calls; `preload.js` with `contextBridge.exposeInMainWorld`; renderer calls via `ipcRenderer.invoke`. This is also exactly CLAUDE.md's `src/resolve/` isolation boundary realized at process level.
- The init sequence: `Initialize(pluginId)` → `SetAPITimeout(n)` → `GetResolve()`, all guarded, plus `CleanUp()` on quit and a `ResolveQuit` callback handler.

**Free to design (Resolve imposes nothing):**

- Renderer stack: any framework + Vite; window size/chrome; always-on-top pinning; menu bar hidden.
- Everything about providers, search UI, caching, SQLite — pure Electron app concerns, testable outside Resolve (only `src/resolve/` code needs the host).
- Build layout: develop in `src/`, build into `plugin/` as the deployable folder mirroring the sample's flat structure; dev-install script copies `plugin/` into the plugins root (symlink/junction pending open question #1).

**Phase 1 must demonstrate:** panel loads in Resolve, handshake shows current project name (calls verified in 3.3), typing works in a text field, clean process exit on window close, and a dev-install script — all of which have verified API support.

**Design constraints locked by findings:** poll for project identity (no events); create-don't-rename for the SFX bin; import = `SetCurrentFolder` + `ImportMedia`; stamp license/attribution via `SetMetadata`/`SetThirdPartyMetadata` at import time; never bundle Electron; rebuild native deps for Electron 36/ABI 135.

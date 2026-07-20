CLAUDE.md — SFXDock



Persistent instructions for Claude Code working in this repository. Read fully before any task. This file is the source of truth for architecture decisions; if a task conflicts with it, stop and flag the conflict instead of proceeding.



What this project is



SFXDock (repo: sfxdock-resolve, display name: "SFXDock for DaVinci Resolve Studio") is an open-source sound effects search plugin for DaVinci Resolve Studio 19+, built as a Workflow Integration Plugin: an Electron app registered under Workspace > Workflow Integrations, communicating with Resolve via its JavaScript API.





Author: Reimo (Costlio OÜ). License: MIT. Public repo from day one.

Platforms: Windows + macOS only. Workflow Integrations do not exist on Linux. Never add Linux support for the panel.

Naming rule (trademark safety): the product name is "SFXDock". "DaVinci Resolve" appears only in the compatibility form "for DaVinci Resolve Studio", never as part of the product name.

YouTube is permanently out of scope for v1. Do not implement it, do not design hooks for it.





Core product facts (locked — do not re-litigate)





Providers, v1: Freesound (sound effects; API key for search/previews; OAuth2 for full-quality downloads) and Jamendo (music; API v3 client_id as apiKey). Plus the built-in Local Folders provider (see below). All searched in parallel from one search box; results merged into one list, filterable by content type (All / SFX / Music) — providers declare which content types they serve. Pixabay was dropped 2026-07-19: its public API has no audio endpoints (verified: only /api/ images and /api/videos/ exist despite marketing claims); revisit only if Pixabay publishes an audio API. Never work around a missing API by scraping.

Pluggable provider architecture is the project's main open-source selling point. A community member adds a provider by writing one module under src/providers/<name>/ and registering it — nothing else. If adding a provider requires touching code outside its own folder and the registry, the interface is broken and must be fixed.

Source badges: every result is visibly tagged Free, Login required, Paid, or Owned (local/already-downloaded). The user always knows what a click costs.

Waveforms on every result. Use provider-supplied waveform assets where available (Freesound ships them); otherwise render client-side from the preview audio (WaveSurfer.js).

Preview playback: stream preview URLs directly for instant playback; caching is an optimization, not a prerequisite. Preview cache policy: bounded disk cache in the OS app-cache dir, keyed by provider + soundId, LRU eviction with a size cap (default 200 MB), secondary TTL sweep (\~30 min), full wipe on app quit. Never evict on search-box change (refined searches replay the same sounds). Prefetch only the first 5–8 visible results, never the full page (rate limits). Cached previews are anonymous temp data and must never enter the library index.

Local library: deliberate downloads go to a user-configurable folder, indexed in SQLite with: source, source ID, license, ready-made attribution string, tags, original query. On every search, local results are shown above remote results. An already-owned sound is never re-downloaded (dedupe by provider + source ID).

Local Folders provider (v1 scope): users add watched folders in settings (the SFXDock downloads folder is pre-registered and non-removable). v1 indexing is filename-level only (tokenized matching, plus path/duration/format), with a manual Rescan button. Results carry the Owned badge, file:// previews, client-rendered waveforms, no auth, no-op download. Deferred to v2: filesystem watchers, embedded tag/BWF/iXML metadata search, duplicate detection. Do not implement v2 items.

Resolve Sound Library: not scriptable — no API reads or writes its index. Never attempt integration with it. Instead, the first-run wizard shows users how to add the SFXDock download folder to their own Sound Library. Embed metadata in downloaded files where the format allows, so native Sound Library keyword search finds them.

Resolve integration: one-click import of a downloaded sound into a dedicated Media Pool bin (default "SFX", configurable), positioned for drag-to-timeline. UI pattern: floating pinnable window. Per-project attribution list export uses the Resolve project context.

License \& attribution are first-class: per-sound "copy attribution" and per-project "export attribution list".

UI copy is English-first, structured so localization can be added later (no hardcoded strings scattered through components; centralize them).





Architecture rules





Only src/resolve/ imports the Resolve/WorkflowIntegration API. Everything else must run and be testable outside Resolve. No exceptions.

src/providers/core/ owns the provider contract and the provider registry. Every provider must pass the contract-conformance test suite in tests/.

Repository layout (top level): plugin/ (deployable plugin folder as Resolve expects — Phase 0 confirmed layout: flat folder containing manifest.xml with Id/Name/Version/Description/FilePath, main.js entry point, preload.js, index.html, renderer assets, WorkflowIntegration.node, optional node_modules/; installed by copying into %PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\; full spec in docs/phase0-audit.md §2), src/main/, src/renderer/, src/providers/{core,freesound,jamendo,local}/, src/library/, src/resolve/, src/shared/, assets/, scripts/, installer/, tests/, docs/.





Provider interface contract



Every provider implements this contract (exact TypeScript definitions live in src/providers/core/; keep them in sync with this description):





id, displayName, homepageUrl

authType: none | apiKey | oauth2 (auth for search/preview) and downloadAuthType (auth for full-quality download — may exceed authType; e.g., Freesound: apiKey → search/preview, oauth2 → full-quality download)

search(query, options, ctx) → normalized raw result list: { providerId, soundId, title, author?, durationSec, license, previewUrl, waveform } — providers return NO badge; the registry decorates results with the centrally derived badge. ctx is an injectable ProviderContext { apiKey, hasOAuth, fetch } so providers are testable without network or credentials.

waveform: { type: 'provided', url } (image asset), { type: 'peaks', peaks: number[] } (amplitude data, drawn client-side — Jamendo ships this), or { type: 'render' } (client renders from preview audio; implemented in Phase 4 for Local Folders)

contentTypes: non-empty array of 'sfx' | 'music' — what the provider serves; the registry skips providers that don't match the active content-type filter

getDownload(sound) → download descriptor (URL + required auth level), or no-op for local sources

licenseInfo(sound) → license identifier + human-readable name + attribution string template

Badge is derived from authType + license via the central mapping in core/ — providers do not invent badge logic.





Coding conventions





TypeScript everywhere (main, renderer, providers, library). Strict mode on.

Renderer: Svelte 5 (runes) built with Vite — established in Phase 1; do not introduce a second framework. TypeScript pinned to 5.x (svelte-check 4 is incompatible with TypeScript 7). IMPORTANT: wrap any $state-derived object in $state.snapshot() before sending it over Electron IPC — a raw reactive proxy fails structured clone (Phase 4 bug). Do clipboard writes in the main process (Electron clipboard module), not navigator.clipboard.

SQLite via the runtime's built-in node:sqlite (DatabaseSync) — Phase 4 decision, replacing the tentative better-sqlite3 plan. Verified working with no flag under both Electron 36.3.2 (Resolve's runtime, SQLite 3.49.1) and the test runner's Node. This eliminates the native-module rebuild / Electron-ABI-lock risk the Phase 0 audit flagged entirely — nothing to rebuild when Resolve bumps Electron. node:sqlite is experimental in Node 22, so re-verify on Resolve updates (the sqlite-probe pattern in scratch/).

Waveform rendering: WaveSurfer.js.

Follow existing patterns found in the codebase and in the Phase 0 audit report (docs/phase0-audit.md) before inventing new ones.

Small, reviewable commits per feature. Tests for provider contract conformance and library logic; Resolve-bound code is manually verified inside Resolve.

Node/Electron pin (Phase 0, verified against Resolve Studio 21.0.0.48): Resolve hosts its own Electron runtime — plugins never bundle Electron. Runtime: Electron 36.3.2, Node 22.15.1, Chromium 136, Node ABI 135, N-API 10. Dev/test/CI run Node 22.x to match; native deps target Electron 36/ABI 135. WorkflowIntegration.node is an N-API module (ABI-stable); always ship the newest copy from Blackmagic's Examples/SamplePlugin/. Re-verify the pin when Resolve updates (probe: process.versions inside the plugin).





Secrets — absolute rule



No API keys, OAuth client secrets, tokens, or credentials are ever committed to this repo — not in code, config, tests, fixtures, docs, or git history. Users supply their own keys via the first-run setup flow. OAuth tokens are stored locally only (OS keychain or local encrypted store; decided in Phase 6). If a task would require embedding a secret, stop and flag it.



Working method





Plan first, build second. Implementation follows the phase specs agreed in the planning project. Do not skip ahead of the current phase.

Every phase begins with its audit/discovery step where specified; report findings before writing code.

Update this file whenever a task establishes a new architectural decision, resolves a Phase 0 unknown (plugin folder layout, Electron bundling model, confirmed API surface, version pins), or completes a phase. Also append to the Decisions Log below.

Push back on scope creep, including from the maintainer: if a request bloats v1, say so and propose deferring to v2.





Phase plan and current status



Current phase: Phase 5 — complete. Next: Phase 6.





Phase 0 — Environment audit: verify Resolve Studio version and Workflow Integration Plugins directory; register and run Blackmagic's sample plugin unmodified; enumerate manifest requirements, Electron bundling model, and the actual WorkflowIntegration API surface (explicitly probe Media Pool ops, project info, and any Sound Library surface). Output: docs/phase0-audit.md + updates to this file. No SFXDock code.

Phase 1 — Skeleton plugin: repo scaffolding, build tooling, minimal SFXDock panel loading inside Resolve, IPC working, Resolve handshake confirmed (show current project name), dev install/symlink script.

Phase 2 — Provider interface + Freesound: provider contract + conformance tests; Freesound with apiKey auth: search, results, streaming preview playback, preview cache (policy above), provided waveforms, Free/Login-required badges, minimal key-entry field (full wizard is Phase 6).

Phase 3 — Jamendo provider (music): pure plugin proof — touches only providers/jamendo/ + registry; parallel multi-provider search with merged results; content-type filter (All / SFX / Music) in contract and UI; peaks-based client-side waveform drawing. (Originally Pixabay; replaced 2026-07-19 — no audio API.)

Phase 4 — Downloads + local library + Local Folders provider: download manager, SQLite index (downloads + watched-folder entries), library-first search, dedupe, per-sound copy-attribution, watched-folder settings with manual Rescan, Owned badge.

Phase 5 — Media Pool import + project attribution export: one-click import into the "SFX" bin via the confirmed API surface; per-project attribution list export; evaluate native drag-out from the panel (Electron webContents.startDrag with the downloaded file) so users can drag a sound directly onto the timeline like a file from Explorer — bin import stays the guaranteed path. All Resolve-API risk lives here.

Phase 6 — Freesound OAuth2 + settings + first-run wizard: OAuth2 full-quality downloads with local token storage; full settings screen (keys, download folder, bin name, watched folders); first-run wizard including obtaining free API keys and adding the download folder to Resolve's Sound Library; auth-aware badges.

Phase 7 — Open-source release: Windows + macOS packaging/installers, CI (lint/tests/build), README with screenshots, LICENSE (MIT), CONTRIBUTING, provider-authoring guide (derived from Phase 3), secrets audit of full history, GitHub topics incl. davinci-resolve.





Decisions log



| Date | Decision | Reason |
|---|---|---|
| 2026-07-19 | Repo structure locked; only src/resolve/ touches the Resolve API | Testability outside Resolve; single failure domain for API risk |
| 2026-07-19 | Phase 4/5 split: library work separated from Media Pool import | Resolve-API surprises must not contaminate pure app logic; smaller reviewable diffs |
| 2026-07-19 | Preview cache: LRU size cap + TTL sweep + wipe on quit; never evict on search change | Refined searches replay the same sounds; search-triggered eviction discards the most-replayed files |
| 2026-07-19 | Streaming-first preview playback; cache is an optimization | Instant playback without full download |
| 2026-07-19 | No Resolve Sound Library integration; guide users to add the download folder to it | Sound Library has no API; folder sharing achieves the same outcome |
| 2026-07-19 | Local folder search ships in v1 as a "Local Folders" provider with Owned badge | Provider architecture absorbs it cheaply; proves non-HTTP providers for the authoring guide |
| 2026-07-19 | v1 local indexing is filename-level with manual rescan; watchers/metadata/dupe-detection deferred to v2 | Scope control — full local indexing is a v2 product |
| 2026-07-19 | Media Pool bin ("SFX") is the one-click import path | Only automatable integration surface |
| 2026-07-19 | Plugins ship no Electron runtime; Resolve launches them with its bundled Electron (36.3.2 in Resolve 21.0.0.48) | Phase 0 finding |
| 2026-07-19 | Toolchain pin: Electron 36.3.2 / Node 22.15.1 / Chromium 136 / ABI 135 / N-API 10; dev+CI on Node 22.x; native deps built for Electron 36 | Phase 0 finding |
| 2026-07-19 | Plugin process model: sandboxed renderer + context isolation (Electron defaults, BMD-recommended since 19.0.2); WorkflowIntegration.node lives in the main process behind typed IPC | Phase 0 finding |
| 2026-07-19 | Plugin folder layout + manifest schema confirmed (5-field manifest.xml, FilePath entry point, flat folder in the plugins root; folder name need not equal plugin Id) | Phase 0 finding |
| 2026-07-19 | Bins cannot be renamed via API (Folder.SetName absent) — changing the configured bin name means creating a new bin, never renaming | Phase 0 finding |
| 2026-07-19 | No project/timeline change events exist (only RenderStart/RenderStop/ResolveQuit callbacks) — SFXDock polls GetCurrentProject().GetUniqueId() for project context | Phase 0 finding |
| 2026-07-19 | Sound Library API confirmed absent at runtime (0 of 194 enumerated method names match /sound/i) — existing no-integration decision stands on verified ground | Phase 0 finding |
| 2026-07-19 | Clip metadata is writable post-import (SetMetadata / SetThirdPartyMetadata verified round-trip) — license + attribution get stamped onto Media Pool clips at import | Phase 0 finding |
| 2026-07-19 | All SFXDock-required Media Pool calls verified working in-Resolve (create bin, set current folder, ImportMedia, AddItemListToMediaPool, clip rename, DeleteClips, DeleteFolders); full pass/fail table in docs/phase0-audit.md §3.3 | Phase 0 finding |
| 2026-07-19 | Guard every session with SetAPITimeout (API calls block while Resolve shows modal dialogs); handle the ResolveQuit callback for graceful shutdown | Phase 0 finding |
| 2026-07-19 | Renderer framework: Svelte 5 with runes, built by Vite | Phase 1 decision (maintainer chose Svelte); compiled output is small and fits a persistent panel |
| 2026-07-19 | Plugin id: com.costlio.sfxdock; installed folder name: SFXDock | Phase 1 decision |
| 2026-07-19 | Never call WorkflowIntegration.CleanUp(): it blocks the main thread forever on Resolve 21 (module v2.0.0) and leaks the process; plain process exit is safe. Shutdown = app.quit() + short force-exit fallback | Phase 1 finding (verified via shutdown logging; BMD's own sample leaks identically) |
| 2026-07-19 | Fast dev loop confirmed: a registered plugin picks up replaced files on next launch from the Workspace menu — full Resolve restart only needed to register new plugins/manifest changes | Phase 1 finding |
| 2026-07-19 | Toolchain: pnpm; TypeScript 5.x (not 7 — svelte-check incompatible); esbuild bundles main/preload; deployable plugin/ is generated by scripts/build.mjs; WorkflowIntegration.node copied from the local Resolve install at build time, never committed | Phase 1 decision |
| 2026-07-19 | Provider contract implemented: providers return raw results without badges (registry decorates centrally); authType split into authType (search/preview) and downloadAuthType (full download); author field added for attribution; injectable ProviderContext for credential-free tests | Phase 2 decision |
| 2026-07-19 | Preview playback via custom sfx-preview:// protocol in the main process: streams upstream audio to the player while tee-ing into the disk cache; renderer CSP stays locked (media only from sfx-preview:) and remote URLs never reach the renderer | Phase 2 decision |
| 2026-07-19 | Provider API keys in plain JSON in userData for v1; keys never cross IPC (status booleans only); OAuth tokens get keychain/encrypted storage in Phase 6 | Phase 2 decision |
| 2026-07-19 | Badge tooltip clarifies that Login required refers to full-quality download cost — previews always play free; verified in user testing that this needs explaining | Phase 2 finding |
| 2026-07-19 | Pixabay dropped from v1: its public API exposes only /api/ (images) and /api/videos/ — no audio endpoints (verified live). Scraping/undocumented endpoints rejected (ToS, fragility). Jamendo (music, API v3, client_id-as-apiKey) replaces it as the second remote provider | Maintainer decision on Phase 3 finding |
| 2026-07-19 | Content-type dimension added to the provider contract: providers declare contentTypes ('sfx'/'music'), registry filters by it, UI gets an All/SFX/Music switch. Freesound = sfx, Jamendo = music, Local Folders = both | Maintainer requirement |
| 2026-07-19 | Waveform contract gains a 'peaks' variant (amplitude array drawn client-side on canvas) — Jamendo ships peaks data; decode-from-audio rendering deferred to Phase 4 where Local Folders actually needs it. RawSoundResult gains optional provider-private 'extra' (e.g., Jamendo's per-track download URL) | Phase 3 decision |
| 2026-07-19 | SQLite via node:sqlite (built-in), NOT better-sqlite3 — verified working with no flag under Electron 36 and the test Node. Eliminates the native-rebuild/ABI-lock risk entirely | Phase 4 finding |
| 2026-07-19 | Download auth-gated by descriptor.requiredAuth vs current auth: Jamendo (apiKey) downloads now; Freesound (oauth2) reports 'login-required' until Phase 6. No preview-quality fallback download — full-quality only, when auth allows | Phase 4 decision |
| 2026-07-19 | Local Folders provider is a factory (createLocalProvider(library)) injecting the LocalIndex, keeping ProviderContext clean; it's the built-in non-HTTP provider. Community HTTP providers still only need ctx.fetch | Phase 4 decision |
| 2026-07-19 | Ownership/library-first handled in the app layer: registry takes an ownedCheck for the central 'owned' badge fact; runSearch sorts owned-first. Local search dedupes a download against a watched copy of the same path (rich record wins) | Phase 4 decision |
| 2026-07-19 | Local file previews stream from disk through the same sfx-preview:// protocol (file: URLs handled directly, uncached); local waveforms decoded client-side via Web Audio (RenderedWaveform) | Phase 4 decision |
| 2026-07-19 | Downloads folder defaults to Documents/SFXDock (findable — Phase 6 wizard points users to add it to Resolve's Sound Library), pre-registered as the non-removable watched folder | Phase 4 decision |
| 2026-07-19 | Embedding license/attribution metadata INTO downloaded files (ID3 etc.) deferred past Phase 4 — attribution is fully captured in the SQLite index and copy/export; file-embedding lands with the Sound Library wizard work | Phase 4 scope note |
| 2026-07-20 | Import to Media Pool verified in Resolve (AddSubFolder/SetCurrentFolder/ImportMedia via bridge.importToBin); bins matched-or-created by configurable name (SFX default) | Phase 5 finding |
| 2026-07-20 | Native drag-out (webContents.startDrag) into the Resolve timeline WORKS — but the drag icon must be a real non-empty nativeImage; an empty/1x1-transparent icon silently no-ops the whole drag | Phase 5 finding |
| 2026-07-20 | Import = download-then-import (into Resolve); Download = save-to-library only (owned/offline, no Media Pool). Kept as distinct actions per the product's library-vs-project split; Import is the primary button. Revisit if users find it redundant | Phase 5 decision (maintainer raised the overlap) |
| 2026-07-20 | Per-project attribution export: imports table links downloads to the project GetUniqueId; export writes a credit .txt for sounds imported into the current project only | Phase 5 decision |
| 2026-07-20 | Window is frameless (frame:false); SFXDock draws its own chrome. Enables the "Mini" mode: a borderless floating search bar (drag handle + inline magnifier, Enter-to-search, Esc-to-clear) that expands to draggable results and collapses back. Frame can't be toggled at runtime, so frameless-always with custom header (drag region + min/close) in full mode | Maintainer UI request |
| 2026-07-20 | Follow-Resolve (Windows only): optional toggle keeps the window at a fixed offset from Resolve's window. Electron can't read another app's bounds and we ship no native modules, so a persistent PowerShell helper (src/main/follow-resolve.ts) reports Resolve's rect via user32 GetWindowRect; offset captured on enable. macOS equivalent deferred | Maintainer UI request |
| 2026-07-20 | Preview playback UX: waveform playhead + screen-blend played-region highlight (all 3 waveform types), click-to-seek. Progress uses the result's known duration since streamed previews report Infinity/NaN | Maintainer UI request |


CLAUDE.md — SFXDock



Persistent instructions for Claude Code working in this repository. Read fully before any task. This file is the source of truth for architecture decisions; if a task conflicts with it, stop and flag the conflict instead of proceeding.



What this project is



SFXDock (repo: sfxdock-resolve, display name: "SFXDock for DaVinci Resolve Studio") is an open-source sound effects search plugin for DaVinci Resolve Studio 19+, built as a Workflow Integration Plugin: an Electron app registered under Workspace > Workflow Integrations, communicating with Resolve via its JavaScript API.





Author: Reimo (Costlio OÜ). License: MIT. Public repo from day one.

Platforms: Windows + macOS only. Workflow Integrations do not exist on Linux. Never add Linux support for the panel.

Naming rule (trademark safety): the product name is "SFXDock". "DaVinci Resolve" appears only in the compatibility form "for DaVinci Resolve Studio", never as part of the product name.

YouTube is permanently out of scope for v1. Do not implement it, do not design hooks for it.





Core product facts (locked — do not re-litigate)





Providers, v1: Freesound (API key for search/previews; OAuth2 for full-quality downloads) and Pixabay Sound Effects (API key). Plus the built-in Local Folders provider (see below). All searched in parallel from one search box; results merged into one list.

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

Repository layout (top level): plugin/ (deployable plugin folder as Resolve expects — Phase 0 confirmed layout: flat folder containing manifest.xml with Id/Name/Version/Description/FilePath, main.js entry point, preload.js, index.html, renderer assets, WorkflowIntegration.node, optional node_modules/; installed by copying into %PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\; full spec in docs/phase0-audit.md §2), src/main/, src/renderer/, src/providers/{core,freesound,pixabay,local}/, src/library/, src/resolve/, src/shared/, assets/, scripts/, installer/, tests/, docs/.





Provider interface contract



Every provider implements this contract (exact TypeScript definitions live in src/providers/core/; keep them in sync with this description):





id, displayName, homepageUrl

authType: none | apiKey | oauth2 — and what each unlocks (e.g., Freesound: apiKey → search/preview; oauth2 → full-quality download)

search(query, options) → normalized result list: { providerId, soundId, title, durationSec, license, badge, previewUrl, waveform }

waveform: either { type: 'provided', url } or { type: 'render' } (client renders from preview audio)

getDownload(sound) → download descriptor (URL + required auth level), or no-op for local sources

licenseInfo(sound) → license identifier + human-readable name + attribution string template

Badge is derived from authType + license via the central mapping in core/ — providers do not invent badge logic.





Coding conventions





TypeScript everywhere (main, renderer, providers, library). Strict mode on.

Renderer: Svelte 5 (runes) built with Vite — established in Phase 1; do not introduce a second framework. TypeScript pinned to 5.x (svelte-check 4 is incompatible with TypeScript 7).

SQLite via better-sqlite3. Phase 0 constraint: it must be built/prebuilt for the pinned Electron ABI below (electron-rebuild or published Electron prebuilds) and rebuilt when a Resolve update bumps Electron. Alternatives (runtime's built-in node:sqlite 3.49.1, or WASM SQLite) are flagged in docs/phase0-audit.md §4; final choice is a Phase 4 decision.

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



Current phase: Phase 1 — complete. Next: Phase 2.





Phase 0 — Environment audit: verify Resolve Studio version and Workflow Integration Plugins directory; register and run Blackmagic's sample plugin unmodified; enumerate manifest requirements, Electron bundling model, and the actual WorkflowIntegration API surface (explicitly probe Media Pool ops, project info, and any Sound Library surface). Output: docs/phase0-audit.md + updates to this file. No SFXDock code.

Phase 1 — Skeleton plugin: repo scaffolding, build tooling, minimal SFXDock panel loading inside Resolve, IPC working, Resolve handshake confirmed (show current project name), dev install/symlink script.

Phase 2 — Provider interface + Freesound: provider contract + conformance tests; Freesound with apiKey auth: search, results, streaming preview playback, preview cache (policy above), provided waveforms, Free/Login-required badges, minimal key-entry field (full wizard is Phase 6).

Phase 3 — Pixabay provider: pure plugin proof — touches only providers/pixabay/ + registry; parallel multi-provider search with merged results; client-side waveform rendering path.

Phase 4 — Downloads + local library + Local Folders provider: download manager, SQLite index (downloads + watched-folder entries), library-first search, dedupe, per-sound copy-attribution, watched-folder settings with manual Rescan, Owned badge.

Phase 5 — Media Pool import + project attribution export: one-click import into the "SFX" bin via the confirmed API surface; per-project attribution list export. All Resolve-API risk lives here.

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


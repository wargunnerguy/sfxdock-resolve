<script lang="ts">
    import type { ConnectionState, FoldersView, KeyStatus, SearchResponse, DownloadOutcome } from '../shared/ipc';
    import type { ContentType, SoundResult } from '../providers/core/types';
    import WaveformPeaks from './WaveformPeaks.svelte';
    import RenderedWaveform from './RenderedWaveform.svelte';

    let conn = $state<ConnectionState>({ connected: false });
    let pinned = $state(false);
    let query = $state('');
    let lastQuery = $state('');
    let contentFilter = $state<'all' | ContentType>('all');
    let searching = $state(false);
    let response = $state<SearchResponse | null>(null);
    let keyStatus = $state<KeyStatus>({});
    let showSettings = $state(false);
    let freesoundKeyInput = $state('');
    let jamendoKeyInput = $state('');
    let keySaved = $state(false);
    let playingId = $state<string | null>(null);
    let folders = $state<FoldersView>({ folders: [], downloadsDir: '' });
    let rescanMsg = $state('');
    // per-result transient status: 'downloading' | 'owned' | 'copied' | error text
    let itemStatus = $state<Record<string, string>>({});

    const audio = new Audio();
    audio.addEventListener('ended', () => (playingId = null));
    audio.addEventListener('error', () => (playingId = null));

    $effect(() => {
        if (!window.sfxdock) {
            conn = { connected: false, error: 'Plugin shell API unavailable (running in a plain browser?)' };
            return;
        }
        window.sfxdock.getState().then((s) => (conn = s));
        window.sfxdock.getKeyStatus().then((s) => (keyStatus = s));
        window.sfxdock.listWatchedFolders().then((f) => (folders = f));
        return window.sfxdock.onStateChanged((s) => (conn = s));
    });

    const hasFreesoundKey = $derived(keyStatus['freesound'] === true);
    const hasJamendoKey = $derived(keyStatus['jamendo'] === true);
    const hasAnyKey = $derived(hasFreesoundKey || hasJamendoKey);

    async function togglePin() {
        pinned = (await window.sfxdock?.setPinned(!pinned)) ?? pinned;
    }

    async function runSearch() {
        const q = query.trim();
        if (!q || !window.sfxdock || searching) return;
        searching = true;
        itemStatus = {};
        try {
            response = await window.sfxdock.search(q, contentFilter === 'all' ? undefined : contentFilter);
            lastQuery = q;
        } finally {
            searching = false;
        }
    }

    async function downloadResult(r: SoundResult) {
        if (!window.sfxdock) return;
        const id = keyFor(r);
        itemStatus = { ...itemStatus, [id]: 'downloading' };
        let outcome: DownloadOutcome;
        try {
            // $state.snapshot: reactive proxies can't be structured-cloned across IPC.
            outcome = await window.sfxdock.download($state.snapshot(r), lastQuery);
        } catch (e) {
            outcome = { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
        const label =
            outcome.status === 'ok'
                ? 'owned'
                : outcome.status === 'already-owned'
                  ? 'owned'
                  : outcome.status === 'login-required'
                    ? 'login needed'
                    : outcome.message;
        itemStatus = { ...itemStatus, [id]: label };
        if (outcome.status === 'ok' || outcome.status === 'already-owned') r.badge = 'owned';
    }

    async function copyAttribution(r: SoundResult) {
        if (!window.sfxdock) return;
        try {
            // Snapshot to avoid cloning the reactive proxy; clipboard write happens in main.
            await window.sfxdock.copyAttribution($state.snapshot(r));
            itemStatus = { ...itemStatus, [keyFor(r)]: 'copied' };
            setTimeout(() => (itemStatus = { ...itemStatus, [keyFor(r)]: '' }), 1800);
        } catch {
            itemStatus = { ...itemStatus, [keyFor(r)]: 'copy failed' };
        }
    }

    async function addFolder() {
        if (!window.sfxdock) return;
        folders = await window.sfxdock.addWatchedFolder();
    }
    async function removeFolder(id: number) {
        if (!window.sfxdock) return;
        folders = await window.sfxdock.removeWatchedFolder(id);
    }
    async function rescan() {
        if (!window.sfxdock) return;
        rescanMsg = 'Rescanning…';
        const res = await window.sfxdock.rescan();
        rescanMsg = `Indexed ${res.added} file${res.added === 1 ? '' : 's'} across ${res.scannedFolders} folder${res.scannedFolders === 1 ? '' : 's'}.`;
        setTimeout(() => (rescanMsg = ''), 4000);
    }

    function setFilter(f: 'all' | ContentType) {
        if (contentFilter === f) return;
        contentFilter = f;
        if (response) void runSearch();
    }

    function keyFor(r: SoundResult): string {
        return `${r.providerId}/${r.soundId}`;
    }

    function togglePlay(r: SoundResult) {
        const id = keyFor(r);
        if (playingId === id) {
            audio.pause();
            playingId = null;
            return;
        }
        audio.src = `sfx-preview://${r.providerId}/${r.soundId}`;
        void audio.play().catch(() => (playingId = null));
        playingId = id;
    }

    async function saveKey(providerId: string, value: string) {
        if (!window.sfxdock) return;
        keyStatus = await window.sfxdock.setProviderKey(providerId, value);
        if (providerId === 'freesound') freesoundKeyInput = '';
        if (providerId === 'jamendo') jamendoKeyInput = '';
        keySaved = true;
        setTimeout(() => (keySaved = false), 2500);
    }

    function formatDuration(sec: number): string {
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    const BADGE_LABEL: Record<string, string> = {
        free: 'Free',
        'login-required': 'Login required',
        paid: 'Paid',
        owned: 'Owned',
    };
</script>

<main>
    <header>
        <h1>SFXDock</h1>
        <div class="header-buttons">
            <button
                class="icon-btn"
                class:active={showSettings}
                onclick={() => (showSettings = !showSettings)}
                title="Settings"
            >
                Settings
            </button>
            <button class="icon-btn" class:active={pinned} onclick={togglePin} title="Keep window on top">
                {pinned ? 'Pinned' : 'Pin'}
            </button>
        </div>
    </header>

    {#if showSettings}
        <section class="settings">
            <h2>Provider keys</h2>
            <label for="fs-key">
                Freesound API key <span class="tag">sound effects</span>
                {#if hasFreesoundKey}<span class="key-ok">set</span>{:else}<span class="key-missing">not set</span>{/if}
            </label>
            <div class="key-row">
                <input
                    id="fs-key"
                    type="password"
                    bind:value={freesoundKeyInput}
                    placeholder={hasFreesoundKey ? 'Enter new key to replace (empty = remove)' : 'Paste your Freesound API key'}
                    spellcheck="false"
                />
                <button onclick={() => saveKey('freesound', freesoundKeyInput)}>{keySaved ? 'Saved' : 'Save'}</button>
            </div>
            <p class="hint">Get a free key at freesound.org/apiv2/apply</p>

            <label for="jm-key" class="second-key">
                Jamendo client ID <span class="tag">music</span>
                {#if hasJamendoKey}<span class="key-ok">set</span>{:else}<span class="key-missing">not set</span>{/if}
            </label>
            <div class="key-row">
                <input
                    id="jm-key"
                    type="password"
                    bind:value={jamendoKeyInput}
                    placeholder={hasJamendoKey ? 'Enter new client ID to replace (empty = remove)' : 'Paste your Jamendo client ID'}
                    spellcheck="false"
                />
                <button onclick={() => saveKey('jamendo', jamendoKeyInput)}>{keySaved ? 'Saved' : 'Save'}</button>
            </div>
            <p class="hint">Get a free client ID at devportal.jamendo.com — keys are stored only on this computer.</p>

            <h2 class="section-gap">Local folders</h2>
            <ul class="folder-list">
                {#each folders.folders as f (f.id)}
                    <li>
                        <span class="folder-path" title={f.path}>{f.path}</span>
                        {#if f.removable}
                            <button class="mini" onclick={() => removeFolder(f.id)}>Remove</button>
                        {:else}
                            <span class="folder-tag">downloads</span>
                        {/if}
                    </li>
                {/each}
            </ul>
            <div class="folder-actions">
                <button onclick={addFolder}>Add folder…</button>
                <button onclick={rescan}>Rescan</button>
                {#if rescanMsg}<span class="hint inline">{rescanMsg}</span>{/if}
            </div>
            <p class="hint">Downloads are saved to your non-removable folder and indexed automatically.</p>
        </section>
    {/if}

    <section class="search">
        <div class="search-row">
            <input
                type="text"
                bind:value={query}
                onkeydown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="Search sounds and music…"
                spellcheck="false"
            />
            <button onclick={runSearch} disabled={searching || query.trim() === ''}>
                {searching ? '…' : 'Search'}
            </button>
        </div>
        <div class="filter-row">
            <button class="chip" class:active={contentFilter === 'all'} onclick={() => setFilter('all')}>All</button>
            <button class="chip" class:active={contentFilter === 'sfx'} onclick={() => setFilter('sfx')}>SFX</button>
            <button class="chip" class:active={contentFilter === 'music'} onclick={() => setFilter('music')}>Music</button>
        </div>
        {#if !hasAnyKey && !showSettings}
            <p class="hint">No provider keys set — open Settings to add a Freesound key (SFX) or Jamendo client ID (music).</p>
        {/if}
    </section>

    {#if response}
        {#each response.errors as err (err.providerId)}
            <div class="error-banner">
                <strong>{err.providerId}</strong>: {err.message}
                {#if err.kind === 'auth'}— check the key in Settings.{/if}
            </div>
        {/each}

        <section class="results">
            {#if response.results.length === 0 && response.errors.length === 0}
                <p class="hint">No results.</p>
            {:else}
                {#each response.results as r (keyFor(r))}
                    <div class="result" class:playing={playingId === keyFor(r)}>
                        <button class="play" onclick={() => togglePlay(r)} title="Preview">
                            {playingId === keyFor(r) ? '⏸' : '▶'}
                        </button>
                        <div class="result-body">
                            <div class="result-top">
                                <span class="title" title={r.title}>{r.title}</span>
                                <span
                                    class="badge badge-{r.badge}"
                                    title={r.badge === 'login-required'
                                        ? 'Previews play free — the badge means full-quality download needs a login (OAuth arrives in a later phase)'
                                        : undefined}>{BADGE_LABEL[r.badge] ?? r.badge}</span>
                            </div>
                            {#if r.waveform.type === 'provided'}
                                <img class="waveform" src={r.waveform.url} alt="" draggable="false" />
                            {:else if r.waveform.type === 'peaks'}
                                <WaveformPeaks peaks={r.waveform.peaks} />
                            {:else}
                                <RenderedWaveform providerId={r.providerId} soundId={r.soundId} />
                            {/if}
                            <div class="result-meta">
                                <span>
                                    {formatDuration(r.durationSec)}
                                    {#if r.author}· {r.author}{/if}
                                    · {r.providerId}
                                </span>
                                <span class="result-actions">
                                    {#if itemStatus[keyFor(r)] === 'copied'}
                                        <span class="ok-text">copied ✓</span>
                                    {:else}
                                        <button class="mini" onclick={() => copyAttribution(r)}>Copy attribution</button>
                                    {/if}
                                    {#if r.providerId !== 'local'}
                                        {#if r.badge === 'owned' || itemStatus[keyFor(r)] === 'owned'}
                                            <span class="ok-text">owned ✓</span>
                                        {:else if itemStatus[keyFor(r)] === 'downloading'}
                                            <span class="hint inline">downloading…</span>
                                        {:else if itemStatus[keyFor(r)] === 'login needed'}
                                            <span class="warn-text" title="Full download needs login (OAuth, a later phase)">login needed</span>
                                        {:else if itemStatus[keyFor(r)]}
                                            <span class="warn-text" title={itemStatus[keyFor(r)]}>failed</span>
                                        {:else}
                                            <button class="mini" onclick={() => downloadResult(r)}>Download</button>
                                        {/if}
                                    {/if}
                                </span>
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}
        </section>
    {:else}
        <section class="status" class:ok={conn.connected}>
            {#if conn.connected}
                <span class="dot ok-dot"></span> {conn.productName} · {conn.projectName ?? '(no project)'}
            {:else}
                <span class="dot err-dot"></span> Not connected to Resolve{conn.error ? ` — ${conn.error}` : ''}
            {/if}
        </section>
    {/if}

    <footer>
        {#if conn.connected && response}
            {conn.projectName ?? ''} · SFXDock 0.1.0
        {:else}
            SFXDock 0.1.0 — Phase 3
        {/if}
    </footer>
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100vh;
        padding: 12px;
        box-sizing: border-box;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    h1 {
        font-size: 17px;
        margin: 0;
        letter-spacing: 0.5px;
    }
    h2 {
        font-size: 13px;
        margin: 0 0 8px;
        color: #bbb;
    }
    .header-buttons {
        display: flex;
        gap: 6px;
    }
    .icon-btn,
    button {
        background: #2a2a2a;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 5px 12px;
        cursor: pointer;
        font-size: 12px;
    }
    button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .icon-btn.active {
        background: #3a5f3a;
        color: #fff;
        border-color: #5a8f5a;
    }
    .settings {
        background: #262626;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 10px 12px;
    }
    .settings label {
        font-size: 12px;
        color: #bbb;
        display: block;
        margin-bottom: 4px;
    }
    .key-ok {
        color: #5fbf5f;
        margin-left: 6px;
    }
    .key-missing {
        color: #bf8f5f;
        margin-left: 6px;
    }
    .key-row {
        display: flex;
        gap: 6px;
    }
    .key-row input {
        flex: 1;
    }
    input {
        background: #1b1b1b;
        color: #eee;
        border: 1px solid #444;
        border-radius: 5px;
        padding: 7px 10px;
        font-size: 13px;
        box-sizing: border-box;
    }
    input:focus {
        outline: none;
        border-color: #6a9fd8;
    }
    .search-row {
        display: flex;
        gap: 6px;
    }
    .search-row input {
        flex: 1;
    }
    .filter-row {
        display: flex;
        gap: 6px;
        margin-top: 8px;
    }
    .chip {
        padding: 3px 14px;
        border-radius: 12px;
        font-size: 11px;
        background: #222;
        border: 1px solid #3c3c3c;
    }
    .chip.active {
        background: #33465f;
        color: #fff;
        border-color: #5a7aa5;
    }
    .second-key {
        margin-top: 12px;
    }
    .tag {
        font-size: 10px;
        color: #7a8aa0;
        margin-left: 4px;
    }
    .hint {
        color: #888;
        font-size: 11px;
        margin: 6px 2px 0;
    }
    .error-banner {
        background: #3a2626;
        border: 1px solid #6f3c3c;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 12px;
        color: #dfa9a9;
    }
    .results {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-height: 0;
    }
    .result {
        display: flex;
        gap: 8px;
        background: #262626;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 8px;
        align-items: center;
    }
    .result.playing {
        border-color: #6a9fd8;
    }
    .play {
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        padding: 0;
        font-size: 13px;
    }
    .result-body {
        flex: 1;
        min-width: 0;
    }
    .result-top {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .title {
        flex: 1;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .badge {
        flex: none;
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 9px;
        border: 1px solid;
    }
    .badge-free {
        color: #7fcf7f;
        border-color: #4f7f4f;
    }
    .badge-login-required {
        color: #cfb27f;
        border-color: #7f6f4f;
    }
    .badge-paid {
        color: #cf8f8f;
        border-color: #7f4f4f;
    }
    .badge-owned {
        color: #8fb2cf;
        border-color: #4f637f;
    }
    .waveform {
        display: block;
        width: 100%;
        height: 34px;
        object-fit: fill;
        margin: 5px 0 3px;
        border-radius: 3px;
        background: #1b1b1b;
    }
    .waveform.placeholder {
        opacity: 0.4;
    }
    .result-meta {
        font-size: 11px;
        color: #888;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .result-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }
    .mini {
        padding: 2px 8px;
        font-size: 10px;
        border-radius: 4px;
    }
    .ok-text {
        color: #7fcf7f;
        font-size: 10px;
    }
    .warn-text {
        color: #cfb27f;
        font-size: 10px;
        cursor: help;
    }
    .inline {
        margin: 0;
    }
    .section-gap {
        margin-top: 16px;
    }
    .folder-list {
        list-style: none;
        padding: 0;
        margin: 0 0 8px;
        font-size: 11px;
    }
    .folder-list li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        border-bottom: 1px solid #303030;
    }
    .folder-path {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #bbb;
    }
    .folder-tag {
        font-size: 9px;
        color: #7a8aa0;
        border: 1px solid #3c4a5f;
        border-radius: 8px;
        padding: 1px 6px;
    }
    .folder-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .status {
        background: #262626;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 9px 12px;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .status.ok {
        border-color: #3a5f3a;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
    }
    .ok-dot {
        background: #5fbf5f;
    }
    .err-dot {
        background: #bf5f5f;
    }
    footer {
        margin-top: auto;
        color: #666;
        font-size: 10px;
        text-align: center;
    }
</style>

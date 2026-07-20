<script lang="ts">
    import type {
        ConnectionState,
        FoldersView,
        KeyStatus,
        SearchResponse,
        DownloadOutcome,
        ImportOutcome,
        ResultField,
        ResultFields,
    } from '../shared/ipc';
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
    // per-result import status: 'importing' | 'imported' | error text
    let importStatus = $state<Record<string, string>>({});
    let binName = $state('SFX');
    let binNameInput = $state('');
    let exportMsg = $state('');
    let compact = $state(false);
    let followResolve = $state(false);
    let resultFields = $state<ResultFields>({ duration: true, quality: true, author: false, provider: true });
    let freesoundClientId = $state('');
    let freesoundConnected = $state(false);
    let connecting = $state(false);
    let connectMsg = $state('');
    let searchInput = $state<HTMLInputElement | undefined>();

    const FIELD_LABELS: Record<ResultField, string> = {
        quality: 'Quality',
        duration: 'Duration',
        provider: 'Source',
        author: 'Uploader',
    };
    const FIELD_ORDER: ResultField[] = ['quality', 'duration', 'provider', 'author'];

    let playProgress = $state(0); // 0..1 position of the currently playing sound
    let playingDuration = 0; // seconds; from the result (streamed audio often has no duration metadata)

    const audio = new Audio();
    let rafId = 0;
    function stopTick() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
    }
    function currentDuration(): number {
        // Streamed previews frequently report Infinity/NaN, so trust the known length.
        if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
        return playingDuration;
    }
    function tick() {
        const dur = currentDuration();
        if (playingId && dur > 0) {
            playProgress = Math.min(1, audio.currentTime / dur);
        }
        if (playingId) rafId = requestAnimationFrame(tick);
    }
    audio.addEventListener('ended', () => {
        playingId = null;
        playProgress = 0;
        stopTick();
    });
    audio.addEventListener('error', () => {
        playingId = null;
        stopTick();
    });

    $effect(() => {
        if (!window.sfxdock) {
            conn = { connected: false, error: 'Plugin shell API unavailable (running in a plain browser?)' };
            return;
        }
        window.sfxdock.getState().then((s) => (conn = s));
        window.sfxdock.getKeyStatus().then((s) => (keyStatus = s));
        window.sfxdock.listWatchedFolders().then((f) => (folders = f));
        window.sfxdock.getBinName().then((n) => {
            binName = n;
            binNameInput = n;
        });
        window.sfxdock.getCompact().then((c) => {
            compact = c;
            window.sfxdock?.setCompact(c); // re-apply min-size / always-on-top to match persisted state
        });
        window.sfxdock.getFollowResolve().then((f) => (followResolve = f));
        window.sfxdock.getResultFields().then((f) => (resultFields = f));
        window.sfxdock.getFreesoundClientId().then((id) => (freesoundClientId = id));
        window.sfxdock.getAuthStatus().then((a) => (freesoundConnected = a.freesound));
        return window.sfxdock.onStateChanged((s) => (conn = s));
    });

    const hasResults = $derived(!!response && response.results.length > 0);

    // In compact mode the window auto-fits: filters+controls on one line, then
    // the search bar; taller when results show.
    $effect(() => {
        if (!window.sfxdock || !compact) return;
        window.sfxdock.setWindowSize(380, hasResults ? 470 : 78);
    });

    async function toggleCompact() {
        compact = !compact;
        await window.sfxdock?.setCompact(compact);
        if (!compact) {
            window.sfxdock?.setWindowSize(420, 640);
        } else {
            showSettings = false;
            searchInput?.focus();
        }
    }

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

    async function importResult(r: SoundResult) {
        if (!window.sfxdock) return;
        const id = keyFor(r);
        importStatus = { ...importStatus, [id]: 'importing' };
        let outcome: ImportOutcome;
        try {
            outcome = await window.sfxdock.importToResolve($state.snapshot(r), lastQuery);
        } catch (e) {
            outcome = { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
        if (outcome.status === 'ok') {
            importStatus = { ...importStatus, [id]: `in ${outcome.binName}` };
            if (r.providerId !== 'local') r.badge = 'owned';
        } else if (outcome.status === 'login-required') {
            importStatus = { ...importStatus, [id]: 'login needed' };
        } else {
            importStatus = { ...importStatus, [id]: outcome.message };
        }
    }

    function onDragStart(r: SoundResult, e: DragEvent) {
        const p = r.extra?.['localPath'] as string | undefined;
        if (!p) return;
        e.preventDefault();
        window.sfxdock?.startDrag(p);
    }

    async function toggleFollow() {
        if (!window.sfxdock) return;
        followResolve = await window.sfxdock.setFollowResolve(!followResolve);
    }

    async function connectFreesound() {
        if (!window.sfxdock || connecting) return;
        await window.sfxdock.setFreesoundClientId(freesoundClientId);
        connecting = true;
        connectMsg = 'Opening your browser to authorize…';
        try {
            const res = await window.sfxdock.connectFreesound();
            if (res.ok) {
                freesoundConnected = true;
                connectMsg = 'Connected to Freesound ✓';
                if (response) void runSearch(); // refresh badges (Login required → Free)
            } else {
                connectMsg = `Could not connect: ${res.error}`;
            }
        } finally {
            connecting = false;
            setTimeout(() => (connectMsg = ''), 6000);
        }
    }

    async function disconnectFreesound() {
        if (!window.sfxdock) return;
        const status = await window.sfxdock.disconnectFreesound();
        freesoundConnected = status.freesound;
        if (response) void runSearch();
    }

    async function saveBinName() {
        if (!window.sfxdock) return;
        binName = await window.sfxdock.setBinName(binNameInput);
        binNameInput = binName;
        keySaved = true;
        setTimeout(() => (keySaved = false), 2000);
    }

    async function exportAttributions() {
        if (!window.sfxdock) return;
        exportMsg = 'Exporting…';
        const res = await window.sfxdock.exportAttributions();
        exportMsg =
            res.status === 'ok'
                ? `Exported ${res.count} sound${res.count === 1 ? '' : 's'}.`
                : res.status === 'empty'
                  ? 'No SFXDock sounds imported into this project yet.'
                  : res.status === 'cancelled'
                    ? ''
                    : `Export failed: ${res.message}`;
        setTimeout(() => (exportMsg = ''), 5000);
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
            stopTick();
            return;
        }
        audio.src = `sfx-preview://${r.providerId}/${r.soundId}`;
        playProgress = 0;
        playingDuration = r.durationSec || 0;
        void audio.play().catch(() => (playingId = null));
        playingId = id;
        stopTick();
        rafId = requestAnimationFrame(tick);
    }

    // Click a waveform to seek within the currently playing sound.
    function seek(r: SoundResult, e: MouseEvent) {
        const dur = currentDuration();
        if (playingId !== keyFor(r) || dur <= 0) return;
        const el = e.currentTarget as HTMLElement;
        const rect = el.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * dur;
        playProgress = ratio;
    }

    function clearResults() {
        response = null;
        query = '';
        searchInput?.focus();
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

    // The meta line under each result, built from the user's enabled fields.
    function metaParts(r: SoundResult): string[] {
        const parts: string[] = [];
        if (resultFields.quality && r.quality) parts.push(r.quality);
        if (resultFields.duration) parts.push(formatDuration(r.durationSec));
        if (resultFields.provider) parts.push(r.providerId);
        if (resultFields.author && r.author) parts.push(r.author);
        return parts;
    }

    async function toggleResultField(field: ResultField) {
        if (!window.sfxdock) return;
        resultFields = await window.sfxdock.setResultField(field, !resultFields[field]);
    }

    const BADGE_LABEL: Record<string, string> = {
        free: 'Free',
        'login-required': 'Login required',
        paid: 'Paid',
        owned: 'Owned',
    };
</script>

<main class:compact>
    {#if compact}
        <div class="compact-handle">
            <div class="mini-filters">
                <button class="chip" class:active={contentFilter === 'all'} onclick={() => setFilter('all')}>All</button>
                <button class="chip" class:active={contentFilter === 'sfx'} onclick={() => setFilter('sfx')}>SFX</button>
                <button class="chip" class:active={contentFilter === 'music'} onclick={() => setFilter('music')}>Music</button>
            </div>
            <div class="compact-controls">
                <button class="win-btn" onclick={toggleCompact} title="Expand to full view">⤢</button>
                <button class="win-btn close" onclick={() => window.sfxdock?.closeWindow()} title="Close">×</button>
            </div>
        </div>
    {:else}
        <header>
            <h1>SFXDock</h1>
            <div class="header-buttons">
                <button class="icon-btn" onclick={toggleCompact} title="Mini floating bar">Mini</button>
                <button
                    class="icon-btn glyph"
                    class:active={showSettings}
                    onclick={() => (showSettings = !showSettings)}
                    title="Settings"
                    aria-label="Settings"
                >
                    ⚙
                </button>
                <button
                    class="icon-btn glyph"
                    class:active={pinned}
                    onclick={togglePin}
                    title={pinned ? 'Pinned on top' : 'Keep window on top'}
                    aria-label="Pin window on top"
                >
                    📌
                </button>
                <button class="win-btn" onclick={() => window.sfxdock?.minimizeWindow()} title="Minimize" aria-label="Minimize">–</button>
                <button class="win-btn close" onclick={() => window.sfxdock?.closeWindow()} title="Close" aria-label="Close">×</button>
            </div>
        </header>
    {/if}

    {#if showSettings && !compact}
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

            <label for="fs-cid" class="second-key">
                Freesound Client ID <span class="tag">full-quality downloads</span>
                {#if freesoundConnected}<span class="key-ok">connected</span>{/if}
            </label>
            <div class="key-row">
                <input
                    id="fs-cid"
                    type="text"
                    bind:value={freesoundClientId}
                    placeholder="Freesound OAuth Client ID"
                    spellcheck="false"
                />
            </div>
            <div class="folder-actions section-gap-sm">
                {#if freesoundConnected}
                    <button onclick={disconnectFreesound}>Disconnect Freesound</button>
                {:else}
                    <button
                        class="primary"
                        onclick={connectFreesound}
                        disabled={connecting || !freesoundClientId || !hasFreesoundKey}
                    >
                        {connecting ? 'Connecting…' : 'Connect Freesound'}
                    </button>
                {/if}
                {#if connectMsg}<span class="hint inline">{connectMsg}</span>{/if}
            </div>
            <p class="hint">
                Set your Freesound app's Callback URL to <strong>http://localhost:8910/callback</strong>, then Connect to
                enable full-quality Freesound downloads.
            </p>

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

            <h2 class="section-gap">Result info</h2>
            <div class="field-toggles">
                {#each FIELD_ORDER as f (f)}
                    <button class="chip" class:active={resultFields[f]} onclick={() => toggleResultField(f)}>
                        {FIELD_LABELS[f]}
                    </button>
                {/each}
            </div>
            <p class="hint">Tap to choose what shows under each result. Quality is on by default; uploader is off.</p>

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

            <h2 class="section-gap">Resolve</h2>
            <label for="bin-name">Import bin name</label>
            <div class="key-row">
                <input id="bin-name" type="text" bind:value={binNameInput} spellcheck="false" />
                <button onclick={saveBinName}>{keySaved ? 'Saved' : 'Save'}</button>
            </div>
            <div class="folder-actions section-gap-sm">
                <button onclick={exportAttributions}>Export attribution list…</button>
                {#if exportMsg}<span class="hint inline">{exportMsg}</span>{/if}
            </div>
            <p class="hint">Exports credits for the sounds you imported into the current Resolve project.</p>

            <div class="folder-actions section-gap">
                <button class:active-btn={followResolve} onclick={toggleFollow}>
                    {followResolve ? 'Following Resolve ✓' : 'Follow Resolve window'}
                </button>
            </div>
            <p class="hint">
                Keeps this window at a fixed offset from Resolve as you move it. Position the window where you want it
                first, then enable. (Windows only.)
            </p>
        </section>
    {/if}

    <section class="search">
        <div class="search-row" class:inline-search={compact}>
            <input
                bind:this={searchInput}
                class:with-inline-btn={compact}
                type="text"
                bind:value={query}
                onkeydown={(e) => {
                    if (e.key === 'Enter') runSearch();
                    else if (e.key === 'Escape') clearResults();
                }}
                placeholder="Search sounds and music…"
                spellcheck="false"
            />
            {#if !compact && (query || hasResults)}
                <button class="icon-btn glyph" onclick={clearResults} title="Clear (Esc)" aria-label="Clear">×</button>
            {/if}
            <button
                class="icon-btn glyph search-btn"
                onclick={runSearch}
                disabled={searching || query.trim() === ''}
                title="Search (or press Enter)"
                aria-label="Search"
            >
                {searching ? '…' : '🔍'}
            </button>
        </div>
        {#if !compact}
            <div class="filter-row">
                <button class="chip" class:active={contentFilter === 'all'} onclick={() => setFilter('all')}>All</button>
                <button class="chip" class:active={contentFilter === 'sfx'} onclick={() => setFilter('sfx')}>SFX</button>
                <button class="chip" class:active={contentFilter === 'music'} onclick={() => setFilter('music')}>Music</button>
            </div>
        {/if}
        {#if !hasAnyKey && !showSettings && !compact}
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
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- Drag-out is an enhancement; the Import button is the accessible path. -->
                    <div
                        class="result"
                        class:playing={playingId === keyFor(r)}
                        class:draggable={!!r.extra?.['localPath']}
                        draggable={!!r.extra?.['localPath']}
                        ondragstart={(e) => onDragStart(r, e)}
                        title={r.extra?.['localPath'] ? 'Drag onto the Resolve timeline, or use Import' : undefined}
                    >
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
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <div
                                class="waveform-wrap"
                                onclick={(e) => seek(r, e)}
                                ondragstart={(e) => e.preventDefault()}
                                draggable="false"
                            >
                                {#if r.waveform.type === 'provided'}
                                    <img class="waveform" src={r.waveform.url} alt="" draggable="false" />
                                {:else if r.waveform.type === 'peaks'}
                                    <WaveformPeaks peaks={r.waveform.peaks} />
                                {:else}
                                    <RenderedWaveform providerId={r.providerId} soundId={r.soundId} />
                                {/if}
                                {#if playingId === keyFor(r)}
                                    <div class="wave-played" style="width: {playProgress * 100}%"></div>
                                    <div class="wave-playhead" style="left: {playProgress * 100}%"></div>
                                {/if}
                            </div>
                            <div class="result-meta">
                                <span>{metaParts(r).join(' · ')}</span>
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
                                            <button
                                                class="mini"
                                                title="Save to your local library (owned, offline) without adding it to Resolve"
                                                onclick={() => downloadResult(r)}>Download</button>
                                        {/if}
                                    {/if}
                                    {#if importStatus[keyFor(r)]?.startsWith('in ')}
                                        <span class="ok-text" title="Imported into your Resolve Media Pool">{importStatus[keyFor(r)]} ✓</span>
                                    {:else if importStatus[keyFor(r)] === 'importing'}
                                        <span class="hint inline">importing…</span>
                                    {:else if importStatus[keyFor(r)] === 'login needed'}
                                        <span class="warn-text" title="Full download needs login (OAuth, a later phase)">login needed</span>
                                    {:else if importStatus[keyFor(r)]}
                                        <span class="warn-text" title={importStatus[keyFor(r)]}>import failed</span>
                                    {:else}
                                        <button
                                            class="mini primary"
                                            title="Add to your Resolve Media Pool bin (downloads first if needed)"
                                            onclick={() => importResult(r)}>Import</button>
                                    {/if}
                                </span>
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}
        </section>
    {:else if !compact}
        <section class="status" class:ok={conn.connected}>
            {#if conn.connected}
                <span class="dot ok-dot"></span> {conn.productName} · {conn.projectName ?? '(no project)'}
            {:else}
                <span class="dot err-dot"></span> Not connected to Resolve{conn.error ? ` — ${conn.error}` : ''}
            {/if}
        </section>
    {/if}

    {#if !compact}
        <footer>
            {#if conn.connected && response}
                {conn.projectName ?? ''} · SFXDock 0.1.0
            {:else}
                SFXDock 0.1.0
            {/if}
        </footer>
    {/if}
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
    main.compact {
        gap: 4px;
        padding: 4px 6px 6px;
    }
    main.compact .search {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    main.compact .search input {
        font-size: 14px;
        padding: 6px 9px;
    }
    main.compact .filter-row {
        margin-top: 0;
    }
    main.compact .chip {
        padding: 2px 10px;
    }
    /* Mini mode: the magnifier sits inside the input (Enter is the main path). */
    .search-row.inline-search {
        position: relative;
    }
    .search-row.inline-search input.with-inline-btn {
        padding-right: 34px;
    }
    .search-row.inline-search .search-btn {
        position: absolute;
        right: 3px;
        top: 50%;
        transform: translateY(-50%);
        background: transparent;
        border: none;
        padding: 4px 6px;
        opacity: 0.65;
    }
    .search-row.inline-search .search-btn:hover:not(:disabled) {
        opacity: 1;
    }

    /* Frameless chrome: the header/handle are OS drag regions; interactive
       elements inside opt out so they stay clickable. */
    header {
        -webkit-app-region: drag;
    }
    header button {
        -webkit-app-region: no-drag;
    }
    .compact-handle {
        -webkit-app-region: drag;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: -1px -2px 0;
    }
    .mini-filters {
        display: flex;
        gap: 4px;
        -webkit-app-region: no-drag;
    }
    .mini-filters .chip {
        padding: 1px 9px;
        font-size: 10px;
    }
    .compact-controls {
        display: flex;
        gap: 2px;
        -webkit-app-region: no-drag;
    }
    .win-btn {
        -webkit-app-region: no-drag;
        background: transparent;
        border: none;
        color: #aaa;
        font-size: 14px;
        line-height: 1;
        padding: 2px 7px;
        border-radius: 4px;
        cursor: pointer;
    }
    .win-btn:hover {
        background: #333;
        color: #fff;
    }
    .win-btn.close:hover {
        background: #a33;
        color: #fff;
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
    .field-toggles {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
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
    .waveform-wrap {
        position: relative;
        margin: 5px 0 3px;
        cursor: pointer;
    }
    .waveform {
        display: block;
        width: 100%;
        height: 34px;
        object-fit: fill;
        border-radius: 3px;
        background: #1b1b1b;
    }
    .waveform.placeholder {
        opacity: 0.4;
    }
    .wave-played {
        position: absolute;
        top: 0;
        left: 0;
        height: 34px;
        /* Screen blend brightens the underlying waveform so the played part
           reads as a distinctly lit, colored region. */
        background: #4a86e8;
        mix-blend-mode: screen;
        border-radius: 3px 0 0 3px;
        pointer-events: none;
    }
    .wave-playhead {
        position: absolute;
        top: 0;
        height: 34px;
        width: 2px;
        background: #dbe7ff;
        box-shadow: 0 0 4px rgba(219, 231, 255, 0.8);
        pointer-events: none;
    }
    .icon-btn.glyph {
        padding: 5px 9px;
        font-size: 13px;
        line-height: 1;
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
    .mini.primary,
    button.primary {
        background: #33465f;
        color: #fff;
        border-color: #5a7aa5;
    }
    .active-btn {
        background: #3a5f3a;
        color: #fff;
        border-color: #5a8f5a;
    }
    .result.draggable {
        cursor: grab;
    }
    .result.draggable:active {
        cursor: grabbing;
    }
    .section-gap-sm {
        margin-top: 8px;
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

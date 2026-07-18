<script lang="ts">
    import type { ConnectionState } from '../shared/ipc';

    let conn = $state<ConnectionState>({ connected: false });
    let pinned = $state(false);
    let search = $state('');

    $effect(() => {
        if (!window.sfxdock) {
            conn = { connected: false, error: 'Plugin shell API unavailable (running in a plain browser?)' };
            return;
        }
        window.sfxdock.getState().then((s) => (conn = s));
        return window.sfxdock.onStateChanged((s) => (conn = s));
    });

    async function togglePin() {
        pinned = (await window.sfxdock?.setPinned(!pinned)) ?? pinned;
    }
</script>

<main>
    <header>
        <h1>SFXDock</h1>
        <button class="pin" class:active={pinned} onclick={togglePin} title="Keep window on top">
            {pinned ? 'Pinned' : 'Pin'}
        </button>
    </header>

    <section class="status" class:ok={conn.connected}>
        {#if conn.connected}
            <div class="row">
                <span class="dot ok-dot"></span>
                Connected to {conn.productName} {conn.resolveVersion}
            </div>
            <div class="project">
                Project: <strong>{conn.projectName ?? '(none open)'}</strong>
            </div>
        {:else}
            <div class="row">
                <span class="dot err-dot"></span>
                Not connected to Resolve
            </div>
            {#if conn.error}
                <div class="error">{conn.error}</div>
            {/if}
        {/if}
    </section>

    <section class="search">
        <input
            type="text"
            bind:value={search}
            placeholder="Search sound effects — coming in Phase 2…"
            spellcheck="false"
        />
        <p class="hint">
            {#if search.length > 0}
                Keyboard input OK — {search.length} character{search.length === 1 ? '' : 's'} received.
            {:else}
                Type here to verify keyboard input reaches the panel.
            {/if}
        </p>
    </section>

    <footer>
        SFXDock 0.1.0 — Phase 1 skeleton
    </footer>
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 14px;
        height: 100vh;
        padding: 14px;
        box-sizing: border-box;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    h1 {
        font-size: 18px;
        margin: 0;
        letter-spacing: 0.5px;
    }
    .pin {
        background: #2a2a2a;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 4px 12px;
        cursor: pointer;
    }
    .pin.active {
        background: #3a5f3a;
        color: #fff;
        border-color: #5a8f5a;
    }
    .status {
        background: #262626;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 13px;
    }
    .status.ok {
        border-color: #3a5f3a;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
    }
    .ok-dot {
        background: #5fbf5f;
    }
    .err-dot {
        background: #bf5f5f;
    }
    .project {
        margin-top: 6px;
        color: #bbb;
    }
    .error {
        margin-top: 6px;
        color: #cf8f8f;
        font-size: 12px;
    }
    .search input {
        width: 100%;
        box-sizing: border-box;
        background: #1b1b1b;
        color: #eee;
        border: 1px solid #444;
        border-radius: 6px;
        padding: 9px 12px;
        font-size: 14px;
    }
    .search input:focus {
        outline: none;
        border-color: #6a9fd8;
    }
    .hint {
        color: #888;
        font-size: 12px;
        margin: 6px 2px 0;
    }
    footer {
        margin-top: auto;
        color: #666;
        font-size: 11px;
        text-align: center;
    }
</style>

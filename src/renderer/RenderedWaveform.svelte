<script lang="ts">
    // Client-rendered waveform for sources that ship no waveform asset (local
    // files). Fetches the preview stream, decodes it, downsamples to peaks, and
    // draws once. Lazy + best-effort: a decode failure just shows the bar bg.
    let { providerId, soundId }: { providerId: string; soundId: string } = $props();
    let canvas = $state<HTMLCanvasElement | undefined>();

    const BUCKETS = 100;

    $effect(() => {
        let cancelled = false;
        void render();
        return () => {
            cancelled = true;
        };

        async function render() {
            if (!canvas) return;
            try {
                const resp = await fetch(`sfx-preview://${providerId}/${soundId}`);
                const buf = await resp.arrayBuffer();
                const ctxAudio = new OfflineAudioContext(1, 1, 44100);
                const decoded = await ctxAudio.decodeAudioData(buf);
                if (cancelled || !canvas) return;
                const data = decoded.getChannelData(0);
                const step = Math.max(1, Math.floor(data.length / BUCKETS));
                const peaks: number[] = [];
                for (let i = 0; i < BUCKETS; i++) {
                    let peak = 0;
                    for (let j = 0; j < step; j++) {
                        const v = Math.abs(data[i * step + j] ?? 0);
                        if (v > peak) peak = v;
                    }
                    peaks.push(peak);
                }
                draw(peaks);
            } catch {
                // leave the empty bar background
            }
        }

        function draw(peaks: number[]) {
            const ctx = canvas?.getContext('2d');
            if (!ctx || !canvas) return;
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            const max = Math.max(...peaks, 0.01);
            const barW = w / peaks.length;
            ctx.fillStyle = '#7a8aa0';
            for (let i = 0; i < peaks.length; i++) {
                const barH = Math.max(1, ((peaks[i] ?? 0) / max) * h);
                ctx.fillRect(i * barW, (h - barH) / 2, Math.max(1, barW - 1), barH);
            }
        }
    });
</script>

<canvas bind:this={canvas} width="400" height="34"></canvas>

<style>
    canvas {
        display: block;
        width: 100%;
        height: 34px;
        margin: 5px 0 3px;
        border-radius: 3px;
        background: #1b1b1b;
    }
</style>

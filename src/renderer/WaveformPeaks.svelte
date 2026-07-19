<script lang="ts">
    let { peaks }: { peaks: number[] } = $props();
    let canvas = $state<HTMLCanvasElement | undefined>();

    $effect(() => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const max = Math.max(...peaks, 1);
        const barW = w / peaks.length;
        ctx.fillStyle = '#7a8aa0';
        for (let i = 0; i < peaks.length; i++) {
            const barH = Math.max(1, ((peaks[i] ?? 0) / max) * h);
            ctx.fillRect(i * barW, (h - barH) / 2, Math.max(1, barW - 1), barH);
        }
    });
</script>

<canvas bind:this={canvas} width="400" height="34"></canvas>

<style>
    canvas {
        display: block;
        width: 100%;
        height: 34px;
        border-radius: 3px;
        background: #1b1b1b;
    }
</style>

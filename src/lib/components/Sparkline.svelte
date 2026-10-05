<script lang="ts">
  let {
    points,
    width = 120,
    height = 32,
    showBaseline = false,
    onDark = false,
    fill = false,
    ariaLabel = 'sparkline'
  }: {
    points: number[];
    width?: number;
    height?: number;
    showBaseline?: boolean;
    onDark?: boolean;
    /**
     * Fill the parent box instead of drawing at `width` × `height` pixels.
     *
     * For a chart that lives in a flexible box (`flex-1`). The SVG is then sized by CSS, not
     * by its own `width`/`height`: feeding a *measured* box size back into the element that
     * fills that box is a feedback loop — box grows, chart grows with it, box grows again,
     * and the hero card walks down the page on every rerender. With `fill` the caller passes
     * a constant viewBox and lets the drawing stretch (`preserveAspectRatio="none"`) into
     * whatever space the parent gives it, so the chart contributes no height of its own.
     */
    fill?: boolean;
    ariaLabel?: string;
  } = $props();

  const uid = $props.id();
  const stroke = $derived(onDark ? '#ff4d5e' : '#e8102e');

  const path = $derived.by(() => {
    if (points.length < 2) return { line: '', area: '' };
    const min = Math.min(0, ...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const step = width / (points.length - 1);
    const xy = points.map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * (height - 2) - 1;
      return [x, y] as const;
    });
    const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  });
</script>

<svg
  viewBox="0 0 {width} {height}"
  width={fill ? '100%' : width}
  height={fill ? '100%' : height}
  preserveAspectRatio={fill ? 'none' : undefined}
  class={fill ? 'block h-full w-full' : 'max-w-full h-auto'}
  role="img"
  aria-label={ariaLabel}
>
  <defs>
    <linearGradient id="spark-{uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color={stroke} stop-opacity="0.22" />
      <stop offset="100%" stop-color={stroke} stop-opacity="0" />
    </linearGradient>
  </defs>
  {#if showBaseline}
    <line
      x1="0" x2={width} y1={height - 1} y2={height - 1}
      stroke={onDark ? '#2b2d33' : '#d9dce0'}
      stroke-width="1" stroke-dasharray="2 3"
    />
  {/if}
  <path d={path.area} fill="url(#spark-{uid})" />
  <path d={path.line} fill="none" stroke={stroke} stroke-width="2" stroke-linecap="round" />
</svg>

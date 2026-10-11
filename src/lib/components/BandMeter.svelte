<script lang="ts">
  // Band meter: position of today's TSB across the five formState() bands.
  // Bands are index-based, not value-based: index 2 (Balanced) holds both the
  // −10…+5 and +5…+25 ranges, so a linear value→x mapping would silently place
  // +25 past the middle. Mapping segment-fraction keeps the cursor honest.
  let {
    tsb,
    ariaLabel = 'Form position'
  }: { tsb: number; ariaLabel?: string } = $props();

  const BANDS = ['Recover', 'Balanced', 'Peak'];
  const SEGMENTS = 5;

  // Same thresholds as formState() in pmc.ts, one per segment start. Note that
  // formState() is tsb <= 5 → balanced, so the +5 value belongs to the END of
  // band 2 here (segment boundary), not the start of band 3 — the cursor sits
  // at 40% at exactly +5 just like formState(5) === 'balanced'.
  const SEG_STARTS = [-30, -10, 5, 25, 45];
  const bandIndex = $derived(
    tsb < SEG_STARTS[0] ? 0 : tsb < SEG_STARTS[1] ? 1 : tsb < SEG_STARTS[2] ? 2 : tsb <= SEG_STARTS[3] ? 3 : 4
  );
  const pct = $derived.by(() => {
    const idx = bandIndex;
    const lo = idx === 0 ? -60 : SEG_STARTS[idx - 1];
    const hi = SEG_STARTS[idx];
    const frac = Math.min(1, Math.max((tsb - lo) / (hi - lo), 0));
    return ((idx + frac) / SEGMENTS) * 100;
  });
</script>

<div class="band-meter" role="img" aria-label={ariaLabel}>
  <div class="bands">
    {#each Array(SEGMENTS) as _, i (i)}
      <span
        class="seg"
        class:active={bandIndex === i}
        style="transition:none"></span>
    {/each}
    <span class="cursor" style="left:{pct}%"></span>
  </div>
  <div class="band-labels">
    {#each BANDS as label, i (label)}
      <!-- label groups mirror the threshold bands: 0–1 Recover, 2–3 Balanced, 4 Peak -->
      <span class:strong={i === (bandIndex <= 1 ? 0 : bandIndex === 4 ? 2 : 1)}>{label}</span>
    {/each}
  </div>
</div>

<style>
  .band-meter {
    width: 100%;
  }
  .bands {
    position: relative;
    display: flex;
    gap: 2px;
    height: 6px;
  }
  .seg {
    flex: 1;
    border-radius: 2px;
    opacity: 0.42;
  }
  .seg:nth-child(1) { background: #ff0055; }
  .seg:nth-child(2) { background: #ff5a6e; }
  .seg:nth-child(3) { background: #fff; }
  .seg:nth-child(4) { background: #6fbb74; }
  .seg:nth-child(5) { background: #ffad2e; }
  .seg.active {
    opacity: 1;
  }
  .cursor {
    position: absolute;
    top: -4px;
    width: 13px;
    height: 13px;
    border-radius: 999px;
    background: #fff;
    border: 4px solid #e8102e;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    transform: translateX(-50%);
  }
  .band-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 5px;
  }
  .band-labels span {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ba1aa;
  }
  .band-labels span.strong {
    color: #fff;
  }
</style>

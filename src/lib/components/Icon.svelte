<script lang="ts">
  /**
   * The app's only way to draw an icon.
   *
   * Route files ask for a name; `icons.ts` owns the geometry. Three things are settled here so
   * no call site has to remember them:
   *
   * - **Stroke width is always passed.** Hugeicons bakes `stroke-width="1.5"` into every path of
   *   its data, and the renderer only overrides that when a `strokeWidth` prop is present. Omitting
   *   the prop would therefore pin every icon to 1.5 and silently flatten the weight hierarchy the
   *   UI uses (1.5 for chrome, 1.8 for content, 2 for a warning that must be read at a glance).
   * - **Decorative icons are hidden from assistive tech.** These glyphs sit beside real text or
   *   inside buttons that already carry an `aria-label`, so an unlabelled `<svg>` would only add
   *   noise. `title` opts out for the rare case where the icon is the only label.
   * - **Colour is inherited.** Hugeicons strokes with `currentColor`, so Tailwind text utilities
   *   keep working; the renderer sets the `color` attribute from the `color` prop, which defaults
   *   to `currentColor` rather than being forced.
   */
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { ICONS, type IconName } from '$lib/icons';

  let {
    name,
    size = 16,
    strokeWidth = 1.5,
    title,
    class: cls
  }: {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    /** Supply only when the glyph carries meaning no adjacent text already states. */
    title?: string;
    class?: string;
  } = $props();
</script>

<HugeiconsIcon
  icon={ICONS[name]}
  {size}
  {strokeWidth}
  class={cls}
  aria-hidden={title ? undefined : 'true'}
  aria-label={title}
  role={title ? 'img' : undefined}
/>

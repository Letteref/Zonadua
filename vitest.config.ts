import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Vitest config, kept separate from `vite.config.ts` on purpose.
 *
 * The E2E specs in `tests/e2e` are named `*.spec.ts` — the conventional Playwright suffix —
 * so a default Vitest run would collect them, try to execute `@playwright/test` under the
 * wrong runner, and fail the unit gate. Scoping `include` to `src` keeps the two suites
 * independent: Vitest owns the domain, Playwright owns the app.
 */
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  plugins: [svelte()],
  test: {
    include: ['src/**/*.{test,spec}.{ts,js}'],
    environment: 'happy-dom'
  }
});
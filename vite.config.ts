import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  // The E2E suite (tests/e2e/strava-connect.spec.ts) tests the honest "not configured"
  // refusal, whose premise is a build without a client id. That used to hold incidentally
  // (no .env in the repo); once a machine's gitignored .env.local carries a real
  // VITE_STRAVA_CLIENT_ID for live testing (docs/STRAVA-SETUP.md step 2), `npm run build:e2e`
  // strips it at build time so the suite's premise stays explicit instead of incidental.
  define:
    mode === 'e2e' ? { 'import.meta.env.VITE_STRAVA_CLIENT_ID': 'undefined' } : undefined,
  plugins: [
    svelte(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Zonadua — Cycling Performance Lab',
        short_name: 'Zonadua',
        description:
          'Local-first cycling performance, route estimation and race-day tracking. All data stays on your device.',
        theme_color: '#f9f9f9',
        background_color: '#f9f9f9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Map tiles (added in M3) — cached conservatively
            urlPattern: /^https:\/\/[a-d]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: {
        enabled: false,
        type: 'module'
      }
    })
  ],
  build: {
    target: 'es2022',
    sourcemap: false
  }
}));

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { toast } from './lib/toast.svelte';

/**
 * Last-resort report for anything that escaped a component's own `catch`.
 *
 * ## Why this matters here
 *
 * Every Dexie write in this app is a local-first promise: the rider's rides, zones and
 * race logs live only in this browser. A rejection nobody handles means data that was
 * never stored, and until now the only record of it was a console line the rider will
 * never open. Surfacing it is the difference between "my logbook lost an entry" and
 * "my logbook lost an entry and I did not know until it was gone".
 *
 * The wording deliberately does not name a cause. A thrown value here is often an
 * `Event`, an opaque cross-origin error, or nothing at all — printing `undefined` into
 * a pill would be worse than saying nothing happened.
 */
/**
 * One failure can reach both listeners: Chromium reports an unhandled rejection as
 * `unhandledrejection` *and* surfaces the same failure to `error`. The two events do not
 * carry the same object — the `error` event wraps the value — so identity cannot pair them.
 * A flag cleared on the next macrotask does: both events for one failure land in the same
 * turn, while a genuinely separate failure a moment later is still reported.
 *
 * Without this the rider pays twice for one failure, and the *generic* wording replaces
 * the specific one that arrived first.
 */
let justReportedRejection = false;

window.addEventListener('unhandledrejection', (event) => {
  justReportedRejection = true;
  setTimeout(() => (justReportedRejection = false), 0);
  console.error('[zonadua] unhandled rejection:', event.reason);
  toast.error('Something did not save — reopen the app if this keeps happening');
});

window.addEventListener('error', (event) => {
  // resource load errors (a failed font, an <img> 404) are not app failures and would
  // otherwise turn every offline reload into a toast the rider cannot act on
  if (event.target !== window) return;
  if (justReportedRejection) return;
  const value = event.error ?? event.message;
  // Chromium fires this every time a layout observer runs again before the browser has
  // delivered its notifications. It is browser housekeeping, not a failure, and it arrives
  // constantly during chart resizes — letting it through drowns the real message and
  // replaces it with a worse one.
  if (typeof value === 'string' && value.startsWith('ResizeObserver loop')) return;
  console.error('[zonadua] uncaught error:', value);
  toast.error('Something went wrong — the data on this device is untouched');
});

const app = mount(App, {
  target: document.getElementById('app')!
});

export default app;

// PWA: registered only in production build (vite-plugin-pwa injects virtual module)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

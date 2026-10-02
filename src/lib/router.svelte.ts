/**
 * Minimal hash router (Svelte 5 runes).
 * Routes: #/ (dashboard), #/rides, #/routes, #/race, #/gear, #/coach, #/settings
 * Detail routes carry one extra segment: #/rides/<activityId>
 * Hash routing = zero server config on Cloudflare Pages.
 */

export type RouteName = 'dashboard' | 'rides' | 'routes' | 'race' | 'gear' | 'coach' | 'settings';

const VALID: readonly RouteName[] = ['dashboard', 'rides', 'routes', 'race', 'gear', 'coach', 'settings'];

interface Parsed {
  name: RouteName;
  /** second path segment, used by detail routes (#/rides/:id) */
  param: string | null;
}

function parseHash(): Parsed {
  const path = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const segments = path.split('/').filter(Boolean);
  const head = segments[0] ?? '';
  const name = (VALID as readonly string[]).includes(head) ? (head as RouteName) : 'dashboard';
  return { name, param: segments[1] ? decodeURIComponent(segments[1]) : null };
}

class Router {
  current = $state<RouteName>('dashboard');
  param = $state<string | null>(null);

  constructor() {
    const initial = parseHash();
    this.current = initial.name;
    this.param = initial.param;
    window.addEventListener('hashchange', () => {
      const next = parseHash();
      this.current = next.name;
      this.param = next.param;
    });
  }

  get name(): RouteName {
    return this.current;
  }

  get detailParam(): string | null {
    return this.param;
  }

  navigate(to: RouteName): void {
    window.location.hash = `#/${to}`;
  }

  /** Navigate to a detail route, e.g. navigateTo('rides', activityId). */
  navigateTo(to: RouteName, param?: string): void {
    window.location.hash = param ? `#/${to}/${encodeURIComponent(param)}` : `#/${to}`;
  }
}

export const route = new Router();
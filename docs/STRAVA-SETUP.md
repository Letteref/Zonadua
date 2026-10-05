# Strava integration — what ships, and how to make it live

This document is the operational half of [ARCHITECTURE.md](ARCHITECTURE.md) §6. It records
which parts of the integration are in the repository, which parts need credentials this repo
cannot hold, and the exact steps to turn the second list into the first.

## What is already in the repo

| Piece | File | State |
| --- | --- | --- |
| PKCE verifier / S256 challenge | `src/lib/infra/strava/pkce.ts` | Done, unit-tested (RFC 7636 vector) |
| Authorize URL, token/refresh bodies, callback + token parsing | `src/lib/infra/strava/oauth.ts` | Done, unit-tested |
| Rate-limit guard (stop at 80% of either window) | `src/lib/infra/strava/ratelimit.ts` | Done, unit-tested |
| Activity summary → `Activity`, streams → samples, URL builders | `src/lib/infra/strava/sync.ts` | Done, unit-tested |
| 7-day API stream pruner (imported files exempt) | `src/lib/infra/strava/prune.ts` | Done, unit-tested |
| Sync status wording ("Not synced yet" / "Needs sync" / "Synced …") | `src/lib/infra/strava/status.ts` | Done, unit-tested; rendered by `components/SyncHint.svelte` |
| Token storage fields on `sync_state` | `src/lib/data/db.ts` (`SyncState`) | Done — `accessToken`/`refreshToken`/`expiresAt`/`athleteId`, no schema bump needed |
| Code ↔ token exchange (holds the client secret) | `functions/api/strava/token.js` | Done — a Cloudflare Pages Function, deployed automatically with `functions/` |

`sync_state` is where both the credentials and the cursor live, so a sync resumed on the same
device picks up after the last activity it pulled.

## What is still open

The connect flow is written and shipped in `src/lib/infra/strava/connect.ts`: `startStravaConnect`
parks the PKCE pair + `state` in `sessionStorage` and redirects to the authorize URL;
`handleStravaCallback` verifies `state`, exchanges the code through the Function and writes the
parsed token to `sync_state`. Every branch is tested — unit
(`src/lib/infra/strava/__tests__/connect.test.ts`) and E2E (`tests/e2e/strava-connect.spec.ts`,
which simulates only Strava's own pages). Settings renders the honest state: **Connect Strava**
when unconfigured, **Connected** with a Disconnect that drops tokens but keeps the cursor.

The ride-pulling half is shipped too, in `src/lib/infra/strava/syncLoop.ts` (loop, injected
deps, unit-tested branch by branch) with `runSync.ts` as the production seam. One **Sync now**
press runs one session: it fetches `/athlete/activities` with the stored cursor, maps through
`mapSummary` (provenance `strava`, no invented zeros), stores the rows, pulls streams for
activities whose stored stream is stale or missing, converts Strava's second-based `time`
series to the app's millisecond convention, stamps `cursor` + `lastSyncAt` **only after work
completed**, then runs `pruneExpiredApiStreams()` for the 7-day API cache policy. `parseRateLimit`
+ `shouldThrottle` gate every response: at 80% of either window the session stops and reports
when it resumes, and a `401` triggers exactly one refresh through the Function (keeping the
stored `refresh_token`, which Strava omits on refresh) before one retry.

What is still open, honestly:

1. **Automatic sync.** Nothing pulls on its own — a session starts when the rider presses
   **Sync now**. Launch-time and post-ride triggers are not built.
2. **Proactive refresh.** The token is refreshed only when Strava answers `401`; a token close
   to expiry is not refreshed before the session.
3. **Backfill of older history.** A session pulls the newest page after the cursor (100, above
   the 50-session cap). Rides older than that first page are never reached, because the cursor
   only moves forward — pulling them needs an explicit rewind, which is not built.

The production connect button also needs `VITE_STRAVA_CLIENT_ID` in the Pages build environment
(Production + Preview): without it the button refuses honestly with "not configured" instead of
redirecting to a broken authorize page.

## Make it live

### 1. Create the Strava API application

<https://www.strava.com/settings/api> → create an app.

- **Authorization Callback Domain**: the host of the origin the app is served from, e.g.
  `zonadua.pages.dev` (no scheme, no path). For local testing against a deployed preview, use
  that preview's host.
- **Website**: the app's public URL.
- Note the **Client ID** and **Client Secret** it shows.
- The app requests one scope, `activity:read_all` (`STRAVA_SCOPE`) — it never asks for write
  access, because Zonadua never uploads, edits or deletes anything in the rider's account.

### 2. Set the Pages environment variables

Cloudflare dashboard → the Pages project → **Settings → Environment variables**:

| Variable | Where | Secret? |
| --- | --- | --- |
| `STRAVA_CLIENT_ID` | Production + Preview | no |
| `STRAVA_CLIENT_SECRET` | Production + Preview | **yes** |
| `VITE_STRAVA_CLIENT_ID` (read by the connect button in `src/lib/infra/strava/connect.ts`) | build environment | no |

The secret is only read by `functions/api/strava/token.js`. It must never be given a `VITE_`
prefix: Vite inlines every `VITE_`-prefixed variable into the client bundle, which is exactly
the leak this Function exists to prevent.

Names with no values live in [.env.example](../.env.example), which also says which consumer
reads each one. To run the Function locally, put `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`
in a `.dev.vars` file — Cloudflare's local counterpart to a project's variables, read by
`wrangler pages dev`. `.dev.vars` and `.wrangler/` are gitignored and have to stay that way:
the client secret is the one value in this project that must never be published.

### 3. Verify the Function is live before writing any UI

With the variables unset, the route should answer:

```bash
curl -i -X POST https://<app>.pages.dev/api/strava/token \
  -H 'content-type: application/json' -d '{"code":"x"}'
# HTTP/2 503  {"error":"strava_not_configured"}
```

That `503` is a pass: it proves the Function is deployed and reading `env`. With the variables
set, a real `{"code": …}` returns Strava's token payload unchanged.

## Testing with real data

Once the connect flow exists, the checks that prove the integration is honest:

- [ ] After connecting, `sync_state.lastSyncAt` is set and the Settings chip reads
      `Last sync <date>` instead of `Never synced`.
- [ ] Imported rides show their own provenance; pulled rides show **strava**, and no demo badge
      appears anywhere (`activityProvenance`).
- [ ] A sync stops at 80% of whichever rate-limit window is closer, rather than being throttled
      mid-run.
- [ ] After 7 days, API-sourced `activity_streams` rows are gone while an imported file's
      streams are untouched (`pruneExpiredApiStreams`).
- [ ] No Strava-derived figure reaches the AI context (ARCHITECTURE.md §5.5).

import { describe, expect, it } from 'vitest';
import {
  BACKUP_CREDENTIALS_NOTE,
  BACKUP_REDACTED_FIELDS,
  buildBackupPayload,
  redactCredentials
} from '../backup';

/**
 * What these guard: a backup file that leaves the device with the rider's AI key or Strava
 * tokens inside it. The failure is quiet — the export still "works", and the leak only shows up
 * in a Downloads folder, a cloud backup, or an attached issue report.
 */
describe('backup credentials are never exported', () => {
  const creds = () => ({
    settings: [
      { id: 'app', unit: 'metric', theme: 'dark', lang: 'en', weatherOn: true, aiProvider: 'openai', aiKey: 'sk-live-REAL', updatedAt: 1 },
      { id: 'stray', unit: 'metric', theme: 'dark', lang: 'en', weatherOn: true, updatedAt: 2 }
    ],
    sync_state: [
      { id: 'strava', lastSyncAt: 10, cursor: 99, accessToken: 'a-REAL', refreshToken: 'r-REAL', expiresAt: 1_700_000_000, athleteId: 77, updatedAt: 3 }
    ],
    activities: [{ id: 'r1', distanceM: 40_000, source: 'manual', updatedAt: 4 }]
  });

  it('drops both the AI key and every Strava token field', () => {
    const out = redactCredentials(creds());
    const settings = out.settings[0] as Record<string, unknown>;
    const sync = out.sync_state[0] as Record<string, unknown>;

    expect(settings.aiKey).toBeUndefined();
    expect(sync.accessToken).toBeUndefined();
    expect(sync.refreshToken).toBeUndefined();
    expect(sync.expiresAt).toBeUndefined();
  });

  it('keeps everything that is not a credential', () => {
    const out = redactCredentials(creds());
    const settings = out.settings[0] as Record<string, unknown>;
    const sync = out.sync_state[0] as Record<string, unknown>;

    // The provider choice is a preference, not a secret — keeping it means the settings
    // screen still shows which provider was used after a restore.
    expect(settings.aiProvider).toBe('openai');
    expect(settings.unit).toBe('metric');
    // Sync bookkeeping is what makes an incremental sync pick up where it left off; losing it
    // would be a real regression, so it must survive the redaction.
    expect(sync.lastSyncAt).toBe(10);
    expect(sync.cursor).toBe(99);
    expect(sync.athleteId).toBe(77);
  });

  it('redacts every row of a table, not just the first', () => {
    const out = redactCredentials(creds());
    for (const row of out.settings) {
      expect((row as Record<string, unknown>).aiKey).toBeUndefined();
    }
  });

  it('leaves no credential field reachable anywhere in the serialized payload', () => {
    const payload = buildBackupPayload(creds(), '2026-10-05T00:00:00.000Z');
    const json = JSON.stringify(payload);
    expect(json).not.toContain('sk-live-REAL');
    expect(json).not.toContain('a-REAL');
    expect(json).not.toContain('r-REAL');
  });

  it('does not mutate the caller’s rows', () => {
    const input = creds();
    redactCredentials(input);
    // The backup reads live rows; deleting fields on them would corrupt what the app keeps in
    // IndexedDB even though the exported file looked right.
    expect((input.settings[0] as Record<string, unknown>).aiKey).toBe('sk-live-REAL');
    expect((input.sync_state[0] as Record<string, unknown>).refreshToken).toBe('r-REAL');
  });

  it('tags the payload so restore can still recognise it, and stamps the time it was given', () => {
    const payload = buildBackupPayload({}, '2026-10-05T12:00:00.000Z');
    expect(payload.app).toBe('zonadua');
    expect(payload.exportedAt).toBe('2026-10-05T12:00:00.000Z');
  });

  it('passes through tables and rows it has no business touching', () => {
    const rows = [{ id: 'x', whatever: 1 }];
    const out = redactCredentials({ activities: rows, weird: null as unknown as unknown[] });
    expect(out.activities).toBe(rows); // untouched table: same reference, no copy cost
    expect(out.weird).toBeNull();
  });

  it('every redaction path names a table and a real settings/sync field, not a typo', () => {
    // A typo here fails open — the field would silently be exported. Pin the intended set.
    expect([...BACKUP_REDACTED_FIELDS].sort()).toEqual([
      'settings.aiKey',
      'sync_state.accessToken',
      'sync_state.expiresAt',
      'sync_state.refreshToken'
    ]);
  });

  it('tells the rider what to expect, so re-keying after a restore is not a surprise', () => {
    expect(BACKUP_CREDENTIALS_NOTE).toMatch(/reconnect Strava/);
    expect(BACKUP_CREDENTIALS_NOTE).toMatch(/AI key/);
  });
});

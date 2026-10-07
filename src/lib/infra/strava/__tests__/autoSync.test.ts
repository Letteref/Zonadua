import { describe, expect, it } from 'vitest';
import {
  AUTO_SYNC_COOLDOWN_MS,
  AUTO_SYNC_FLAG,
  AUTO_SYNC_IN_FLIGHT,
  autoSyncGate,
  type AutoSyncGateInput
} from '../autoSync';

const now = Date.parse('2026-10-07T08:00:00Z');

const base: AutoSyncGateInput = {
  sync: { accessToken: 'at-1' },
  online: true,
  sessionFlag: null,
  booted: true,
  now
};

describe('autoSync gate', () => {
  it('opens for a connected, online, booted tab with no prior session', () => {
    expect(autoSyncGate(base)).toEqual({ ok: true });
  });

  it('stays silent when not connected — an empty device is not an error to nag about', () => {
    for (const sync of [null, undefined, {}, { accessToken: '' }]) {
      expect(autoSyncGate({ ...base, sync: sync as AutoSyncGateInput['sync'] })).toEqual({
        ok: false,
        reason: 'not_connected'
      });
    }
  });

  it('refuses to run before the boot sequence finished', () => {
    expect(autoSyncGate({ ...base, booted: false })).toEqual({ ok: false, reason: 'not_booted' });
  });

  it('refuses to run offline', () => {
    expect(autoSyncGate({ ...base, online: false })).toEqual({ ok: false, reason: 'offline' });
  });

  it('does not start a second session while one is in flight in this tab', () => {
    expect(autoSyncGate({ ...base, sessionFlag: AUTO_SYNC_IN_FLIGHT })).toEqual({
      ok: false,
      reason: 'already_syncing'
    });
  });

  it('skips a re-boot inside the cooldown window', () => {
    const flag = String(now - AUTO_SYNC_COOLDOWN_MS / 2);
    expect(autoSyncGate({ ...base, sessionFlag: flag })).toEqual({ ok: false, reason: 'cooling_down' });
  });

  it('runs again after the cooldown window passes', () => {
    const flag = String(now - AUTO_SYNC_COOLDOWN_MS - 1);
    expect(autoSyncGate({ ...base, sessionFlag: flag })).toEqual({ ok: true });
  });

  it('treats a junk marker as no session rather than as permission or a block', () => {
    expect(autoSyncGate({ ...base, sessionFlag: 'not-a-number' })).toEqual({ ok: true });
  });

  it('holds the marker values the runner writes', () => {
    // pins the contract between gate, runner and sessionStorage
    expect(AUTO_SYNC_IN_FLIGHT).toBe('syncing');
    expect(AUTO_SYNC_FLAG).toBe('zonadua.strava.autosync');
  });
});

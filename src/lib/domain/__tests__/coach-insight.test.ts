import { describe, expect, it } from 'vitest';
import { buildCoachInsight, polishPrompt, type InsightInput } from '../coach-insight';

/** Neutral mid-training baseline; each test overrides only what it is about. */
const BASE: InsightInput = {
  ctl: 68,
  atl: 64,
  tsb: 4,
  tsbDelta7d: 2,
  weekTss: 320,
  weekKm: 180,
  weekRides: 3,
  tssTarget: 450,
  ftp: 265,
  ftpAgeDays: 30,
  hiShare30d: 18,
  race: null,
  wear: null
};
const input = (over: Partial<InsightInput> = {}): InsightInput => ({ ...BASE, ...over });

describe('buildCoachInsight priority chain', () => {
  it('a race inside 14 days outranks everything else', () => {
    // deep fatigue AND a close race: race week wins, because the advice differs
    const i = buildCoachInsight(
      input({ race: { name: 'Gran Fondo', days: 5 }, tsb: -35, tsbDelta7d: -14 })
    );
    expect(i.severity).toBe('critical');
    expect(i.tag).toBe('Race week');
    expect(i.headline).toContain('Gran Fondo');
    expect(i.headline).toContain('in 5 days');
  });

  it('says tomorrow when the race is one day out', () => {
    const i = buildCoachInsight(input({ race: { name: 'Kermis', days: 1 } }));
    expect(i.headline).toContain('tomorrow');
  });

  it('a race more than 14 days out does not trigger race week', () => {
    const i = buildCoachInsight(input({ race: { name: 'Gran Fondo', days: 28 } }));
    expect(i.tag).not.toBe('Race week');
  });

  it('flags a fatigue spike: deep TSB and a falling trend', () => {
    const i = buildCoachInsight(input({ tsb: -30, tsbDelta7d: -12 }));
    expect(i.severity).toBe('critical');
    expect(i.tag).toBe('Fatigue alert');
    expect(i.headline).toContain('12 points');
    expect(i.headline).toContain('TSB -30');
  });

  it('deep TSB without a fresh drop is not a fatigue alert', () => {
    // already deep for weeks: steady-state, not a spike
    const i = buildCoachInsight(input({ tsb: -30, tsbDelta7d: 0 }));
    expect(i.tag).not.toBe('Fatigue alert');
  });

  it('high freshness calls the window to push', () => {
    const i = buildCoachInsight(input({ tsb: 18 }));
    expect(i.severity).toBe('good');
    expect(i.tag).toBe('Fresh legs');
    expect(i.headline).toContain('+18 TSB');
  });

  it('weekly target under 70% reads as watch', () => {
    const i = buildCoachInsight(input({ weekTss: 200, tssTarget: 450 }));
    expect(i.severity).toBe('watch');
    expect(i.tag).toBe('Below target');
    expect(i.headline).toContain('200');
    expect(i.headline).toContain('450');
    expect(i.headline).toContain('44%');
  });

  it('weekly target over 125% reads as big week', () => {
    const i = buildCoachInsight(input({ weekTss: 600, tssTarget: 450 }));
    expect(i.tag).toBe('Big week');
    expect(i.headline).toContain('133%');
  });

  it('on-target week reads as on track', () => {
    const i = buildCoachInsight(input({ weekTss: 430, tssTarget: 450 }));
    expect(i.severity).toBe('good');
    expect(i.tag).toBe('On track');
  });

  it('stale FTP surfaces only when the week is on track', () => {
    const i = buildCoachInsight(input({ weekTss: 430, ftpAgeDays: 75 }));
    // on-track branch comes first in the chain
    expect(i.tag).toBe('On track');
    // but with no week load, the stale FTP is the story
    const j = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 75 }));
    expect(j.tag).toBe('FTP check');
    expect(j.headline).toContain('265 W');
    expect(j.headline).toContain('75 days ago');
  });

  it('fresh FTP does not raise the FTP-check story', () => {
    const i = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 10 }));
    expect(i.tag).toBe('Keep riding');
  });

  it('falls back to keep-riding with the week km when nothing else applies', () => {
    const i = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 10, weekKm: 120, weekRides: 2 }));
    expect(i.severity).toBe('good');
    expect(i.tag).toBe('Keep riding');
    expect(i.headline).toContain('120 km');
    expect(i.headline).toContain('2 rides');
  });

  it('says no rides rather than a pluralised zero when the week is empty', () => {
    const i = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 10, weekKm: 0, weekRides: 0 }));
    expect(i.headline).toContain('No rides logged');
  });

  it('singularises ride', () => {
    const i = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 10, weekKm: 40, weekRides: 1 }));
    expect(i.headline).toContain('1 ride this week');
    expect(i.headline).not.toContain('1 rides');
  });
});

describe('evidence', () => {
  it('restates the figures the headline used, rounded', () => {
    const i = buildCoachInsight(input({ ctl: 67.6, atl: 63.4, tsb: 4.2 }));
    expect(i.evidence).toContain('CTL 68');
    expect(i.evidence).toContain('ATL 63');
    expect(i.evidence).toContain('TSB +4');
    expect(i.evidence).toContain('7d load 320 TSS');
  });

  it('marks negative TSB without a double sign', () => {
    const i = buildCoachInsight(input({ tsb: -30, tsbDelta7d: 0 }));
    expect(i.evidence).toContain('TSB -30');
    expect(i.evidence).not.toContain('TSB --30');
  });

  it('omits absent figures instead of printing zero', () => {
    const i = buildCoachInsight(input({ ctl: null, atl: null, tsb: null, tsbDelta7d: null, weekTss: 0, ftpAgeDays: 10 }));
    expect(i.evidence).toBe('7d load 0 TSS');
  });
});

describe('polishPrompt', () => {
  it('embeds the evidence figures in the prompt so verifyNumbers can check them', () => {
    const insight = buildCoachInsight(input());
    const { prompt, system } = polishPrompt(insight);
    expect(prompt).toContain(insight.evidence);
    expect(prompt).toContain(insight.headline);
    expect(prompt).toContain(insight.advice);
    // the model is told to keep numbers verbatim — the verify gate depends on it
    expect(system).toContain('EXACTLY');
  });
});

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
  wear: null,
  avgRideMin30d: 75
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
    const i = buildCoachInsight(input({ ctl: null, atl: null, tsb: null, tsbDelta7d: null, weekTss: 0, ftpAgeDays: 10, hiShare30d: null }));
    expect(i.evidence).toBe('7d load 0 TSS');
  });

  it('restates the intensity share, which the advice quotes', () => {
    const i = buildCoachInsight(input({ hiShare30d: 41.5 }));
    expect(i.evidence).toContain('41.5% of time at/above sweet spot (30d)');
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

describe('advice is a rideable prescription, not a restated report', () => {
  // Every branch must answer "what do I ride today" with duration, intensity and
  // structure — a card that only reads the chart back is a shorter chart.
  it('race eve prescribes the last short spin, scaled to the rider\'s own ride length', () => {
    const i = buildCoachInsight(input({ race: { name: 'Kermis', days: 1 } }));
    // BASE rides 75 min on average → the eve spin is half of that, rounded to 5
    expect(i.advice).toContain('40 min easy');
    // hiShare30d 18 is already snap-heavy → fewer opener sprints
    expect(i.advice).toContain('2×10 s single-gear sprints');
  });

  it('race inside a week prescribes one sharpener inside an easy hour', () => {
    const i = buildCoachInsight(input({ race: { name: 'Gran Fondo', days: 5 } }));
    expect(i.advice).toContain('2×5 min at race pace');
  });

  it('race in 8–14 days gets the last hard session', () => {
    const i = buildCoachInsight(input({ race: { name: 'Gran Fondo', days: 10 } }));
    expect(i.advice).toContain('2×10 min at FTP');
    expect(i.advice).toContain('75 min');
  });

  it('deep fatigue cancels the hard session even inside race week', () => {
    const i = buildCoachInsight(
      input({ race: { name: 'Gran Fondo', days: 10 }, tsb: -30, tsbDelta7d: -4 })
    );
    expect(i.tag).toBe('Race week');
    expect(i.advice).toContain('no hard efforts');
    expect(i.advice).not.toContain('2×10 min');
  });

  it('fatigue alert prescribes a capped easy day, not just a warning', () => {
    const i = buildCoachInsight(input({ tsb: -30, tsbDelta7d: -12 }));
    expect(i.advice).toContain('45 min max');
    expect(i.advice).toContain('Zone 1–2');
  });

  it('fresh legs with a clean intensity budget get the threshold session', () => {
    const i = buildCoachInsight(input({ tsb: 18, hiShare30d: 10 }));
    expect(i.advice).toContain('2×20 min at FTP');
    expect(i.advice).toContain('15 min warm-up');
  });

  it('fresh legs on a spent intensity budget get volume instead of intervals', () => {
    const i = buildCoachInsight(input({ tsb: 18, hiShare30d: 40 }));
    expect(i.advice).toContain('40% of the last 30 days');
    expect(i.advice).toContain('skip the intervals');
    expect(i.advice).toContain('90 min at Zone 2');
    expect(i.advice).not.toContain('2×20 min');
    // and the spent budget is a measured figure, so evidence carries it too
    expect(i.evidence).toContain('40% of time at/above sweet spot (30d)');
  });

  it('a worn component gets a caution attached to the quality session', () => {
    const i = buildCoachInsight(input({ tsb: 18, hiShare30d: 10, wear: { name: 'chain', pct: 0.9 } }));
    expect(i.advice).toContain('chain');
    expect(i.advice).toContain('90% of its service interval');
  });

  it('a small weekly gap is closed by one prescribed ride', () => {
    const i = buildCoachInsight(input({ weekTss: 160, tssTarget: 250 })); // 64%, gap 90
    expect(i.tag).toBe('Below target');
    expect(i.advice).toContain('One ride closes it');
    expect(i.advice).toContain('90 TSS you\'re short');
  });

  it('a large weekly gap is split across two rides instead of a hero ride', () => {
    const i = buildCoachInsight(input({ weekTss: 200, tssTarget: 450 })); // 44%, gap 250
    expect(i.advice).toContain('two rides');
    expect(i.advice).toContain('250 TSS you\'re short');
  });

  it('a big week prescribes rest, not more work', () => {
    const i = buildCoachInsight(input({ weekTss: 600, tssTarget: 450 }));
    expect(i.advice).toContain('rest day');
    expect(i.advice).toContain('Skip the interval ride');
  });

  it('on target with productive form, quality is prescribed', () => {
    const i = buildCoachInsight(input({ weekTss: 430, tsb: 10, hiShare30d: 18 }));
    expect(i.tag).toBe('On track');
    expect(i.advice).toContain('next ride is quality');
    expect(i.advice).toContain('2×10 min at FTP');
  });

  it('on target but deep form bends the plan to easy', () => {
    const i = buildCoachInsight(input({ weekTss: 430, tsb: -35, tsbDelta7d: 0, weekKm: 0, weekRides: 0 }));
    expect(i.tag).toBe('On track');
    expect(i.advice).toContain('no intervals');
    expect(i.advice).toContain('Zone 1–2');
  });

  it('on target with balanced form keeps consistency, with an optional sweet-spot block sized to the ride', () => {
    const i = buildCoachInsight(input({ weekTss: 430 })); // BASE tsb 4 → balanced
    expect(i.tag).toBe('On track');
    expect(i.advice).toContain('75 min at Zone 2');
    expect(i.advice).toContain('2×10 min sweet spot');
  });

  it('stale FTP gets the full test protocol, factor included', () => {
    const i = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 75 }));
    expect(i.advice).toContain('20 min all-out');
    expect(i.advice).toContain('0.95');
  });

  it('the fallback still prescribes a concrete ride', () => {
    const i = buildCoachInsight(input({ weekTss: 0, ftpAgeDays: 10, weekKm: 120, weekRides: 2 }));
    expect(i.advice).toContain('70 min at Zone 2');
  });
});

describe('prescriptions are computed from the rider, never canned', () => {
  it('race-eve spin scales with the rider\'s own average ride length', () => {
    const short = buildCoachInsight(
      input({ race: { name: 'Kermis', days: 1 }, avgRideMin30d: 40 })
    );
    const long = buildCoachInsight(
      input({ race: { name: 'Kermis', days: 1 }, avgRideMin30d: 110 })
    );
    expect(short.advice).toContain('20 min easy'); // half of 40
    expect(long.advice).toContain('45 min easy'); // half of 110, clamped to the band
    expect(short.advice).not.toBe(long.advice);
  });

  it('opener sprint count follows the recent intensity share', () => {
    const scarce = buildCoachInsight(
      input({ race: { name: 'Kermis', days: 1 }, hiShare30d: 2 })
    );
    const loaded = buildCoachInsight(
      input({ race: { name: 'Kermis', days: 1 }, hiShare30d: 40 })
    );
    const none = buildCoachInsight(input({ race: { name: 'Kermis', days: 1 }, hiShare30d: null }));
    expect(scarce.advice).toContain('4×10 s'); // snap work is scarce → more openers
    expect(loaded.advice).toContain('2×10 s'); // legs already know the movement
    expect(none.advice).toContain('3×10 s'); // no data → the stated neutral
  });

  it('the below-target ride length is solved from the TSS gap itself', () => {
    const small = buildCoachInsight(input({ weekTss: 90, tssTarget: 140 })); // 64%, gap 50
    const large = buildCoachInsight(input({ weekTss: 160, tssTarget: 250 })); // 64%, gap 90
    expect(small.advice).toContain('45 min at Zone 2');
    expect(small.advice).toContain("50 TSS you're short");
    expect(large.advice).toContain('85 min at Zone 2');
    expect(large.advice).toContain("90 TSS you're short");
    // longer gap → longer ride, from the same branch
    expect(small.advice).not.toBe(large.advice);
  });

  it('a threshold session\'s warm-up and blocks scale with the prescribed ride', () => {
    const short = buildCoachInsight(input({ tsb: 18, hiShare30d: 10, avgRideMin30d: 75 }));
    const long = buildCoachInsight(input({ tsb: 18, hiShare30d: 10, avgRideMin30d: 120 }));
    // 75 min ride: 15 min warm-up, 40 min work split 2×20
    expect(short.advice).toContain('75 min in the saddle');
    expect(short.advice).toContain('15 min warm-up');
    expect(short.advice).toContain('2×20 min at FTP');
    // 120 min ride: 25 min warm-up, 60 min work split 3×20
    expect(long.advice).toContain('120 min in the saddle');
    expect(long.advice).toContain('25 min warm-up');
    expect(long.advice).toContain('3×20 min at FTP');
  });

  it('falls back to the documented neutral hour when no ride history exists', () => {
    const i = buildCoachInsight(
      input({ weekTss: 0, ftpAgeDays: 10, weekKm: 0, weekRides: 0, avgRideMin30d: null })
    );
    // neutral 60 min × 0.85 → 50 min, clamped up to the 45-min band floor
    expect(i.advice).toContain('50 min at Zone 2');
  });
});

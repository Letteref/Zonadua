import { describe, expect, it } from 'vitest';
import { extractNumbers, rejectionNotice, verifyNumbers } from '../verify';

/**
 * The verifier is the only mechanism in M5 that can *catch* a model inventing something
 * rather than merely discouraging it. These tests therefore concentrate on the failures
 * it has to catch, not on the replies it should pass.
 */

const CONTEXT = [
  '# Rider context',
  'rides: 2',
  'distance_km: 150',
  'elevation_gain_m: 1800',
  'moving_time_min: 360',
  'tss: 290',
  'weight_kg: 68.2',
  'ftp_w: 275',
  'ctl: 62',
  'atl: 55',
  'tsb: 7'
].join('\n');

describe('extractNumbers', () => {
  it('reads plain figures, decimals and thousands separators as single numbers', () => {
    expect(extractNumbers('you rode 150 km, climbed 1800 m, and averaged 31.9 km/h')).toEqual([150, 1800, 31.9]);
    // a formatted figure must not be read as three separate numbers
    expect(extractNumbers('a total of 1,450 m of climbing')).toEqual([1450]);
  });

  it('returns nothing for a reply that states no figures', () => {
    expect(extractNumbers('Consistency matters more than intensity this week.')).toEqual([]);
  });
});

describe('verifyNumbers', () => {
  it('passes a reply whose figures all come from the context', () => {
    const v = verifyNumbers(
      'You rode 2 rides for 150 km and logged 290 TSS. FTP is 275 W and your CTL sits at 62.',
      CONTEXT
    );
    expect(v.ungrounded).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('catches the failure this exists for: a model quietly changing the FTP', () => {
    // 315 W is a perfectly plausible FTP, and a rider has no way to tell it from their
    // own 275 W by reading the sentence
    const v = verifyNumbers('You are sitting at 315 W FTP, up from last month.', CONTEXT);
    expect(v.ungrounded).toContain(315);
    expect(v.ok).toBe(false);
  });

  it('names the offending figure rather than only reporting failure', () => {
    const v = verifyNumbers('You climbed 2,900 m this week.', CONTEXT);
    expect(v.ungrounded).toEqual([2900]);
    // "this response failed" is not actionable; "2900" is
    expect(rejectionNotice(v.ungrounded)).toContain('2900');
  });

  it('tolerates the rounding every model does, without tolerating invention', () => {
    // 275 → 274.6 is rounding; 275 → 315 is not. Both must land on the right side of
    // that line, which is the whole reason the tolerance is relative and small.
    const rounded = verifyNumbers('Your FTP is about 274.6 W.', CONTEXT);
    expect(rounded.ok).toBe(true);

    const invented = verifyNumbers('Your FTP is 315 W.', CONTEXT);
    expect(invented.ok).toBe(false);
  });

  it('does not flag small structural counts as invented figures', () => {
    // "2 rides" and "a 3 week block" are not claims about the rider's data; flagging
    // them would make the check fire constantly and get switched off
    const v = verifyNumbers(
      'Across 2 rides over a 3 week block, your consistency held.',
      CONTEXT
    );
    expect(v.ok).toBe(true);
  });

  it('ignores small ordinals and round counts that carry no claim', () => {
    expect(verifyNumbers('First, second — the 7 day load.', CONTEXT).ok).toBe(true);
  });

  it('flags an invented figure even when surrounded by correct ones', () => {
    const v = verifyNumbers(
      'You rode 150 km (correct) and hit 420 W on your hardest effort (invented).',
      CONTEXT
    );
    expect(v.stated).toContain(420);
    expect(v.ungrounded).toEqual([420]);
    expect(v.grounded).toContain(150);
  });

  it('passes a reply that makes no numerical claim at all', () => {
    const v = verifyNumbers('Your week was steady — keep the pattern going.', CONTEXT);
    expect(v.stated).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('catches an invented figure when the context itself is thin', () => {
    // the common real case: almost nothing is known, so a model reaching for a number
    const thin = 'weight_kg: not measured\nftp_w: not measured';
    const v = verifyNumbers('At 72 kg with an FTP of 280 you are right where you need to be.', thin);
    expect(v.ok).toBe(false);
    expect(v.ungrounded).toContain(72);
    expect(v.ungrounded).toContain(280);
  });

  it('reports stated and grounded figures separately from the verdict', () => {
    const v = verifyNumbers('150 km at 290 TSS, and a peak of 999 W.', CONTEXT);
    expect(v.stated).toEqual([150, 290, 999]);
    expect(v.grounded).toContain(150);
    expect(v.grounded).toContain(290);
    expect(v.ok).toBe(false);
  });
});

describe('rejectionNotice', () => {
  it('states that the figure was withheld rather than implying the reply was empty', () => {
    const notice = rejectionNotice([312]);
    expect(notice).toContain('312');
    expect(notice).toMatch(/withheld/i);
  });
});

import { describe, expect, it } from 'vitest';
import { ftpFromTwentyMinuteTest, TWENTY_MINUTE_TEST_FACTOR } from '../ftp';

describe('ftpFromTwentyMinuteTest', () => {
  it('returns 95% of the test average, rounded to a whole watt', () => {
    expect(ftpFromTwentyMinuteTest(280)).toBe(266); // 266.0 exactly
    expect(ftpFromTwentyMinuteTest(274)).toBe(260); // 260.3 rounds down
    expect(ftpFromTwentyMinuteTest(275)).toBe(261); // 261.25 rounds up
    expect(TWENTY_MINUTE_TEST_FACTOR).toBe(0.95);
  });

  it('rejects empty, zero and non-finite input — no FTP of 0 or NaN', () => {
    expect(ftpFromTwentyMinuteTest(0)).toBeNull();
    expect(ftpFromTwentyMinuteTest(-12)).toBeNull();
    expect(ftpFromTwentyMinuteTest(Number.NaN)).toBeNull();
    expect(ftpFromTwentyMinuteTest(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('accepts small positive values — the correctness bar is arithmetic, not physiology', () => {
    expect(ftpFromTwentyMinuteTest(100)).toBe(95);
  });
});

/**
 * FTP estimation from a field test.
 *
 * The classic protocol: ride 20 minutes as hard as you can, take the average
 * power, and multiply by 0.95 — the 5% shave accounts for the difference
 * between a 20-minute all-out effort and the hour a true threshold can hold.
 * The result feeds `ftp_history` through the Settings screen, and from there
 * every IF/TSS figure in the app is divided by it (metrics.ts), so the
 * constant lives here, once, where its meaning is stated.
 *
 * A pure function on purpose: the Settings calculator and the tests share it,
 * and no side effect can hide behind a rounding.
 */

/** Multiplier from a 20-minute all-out average to a threshold estimate. */
export const TWENTY_MINUTE_TEST_FACTOR = 0.95;

/**
 * Estimated FTP (watts) from a 20-minute test's average power, rounded to a
 * whole watt. Returns `null` for anything that is not a positive number —
 * an empty or mistyped input must not become an FTP of 0 or NaN.
 */
export function ftpFromTwentyMinuteTest(avgWatts: number): number | null {
  if (!Number.isFinite(avgWatts) || avgWatts <= 0) return null;
  return Math.round(avgWatts * TWENTY_MINUTE_TEST_FACTOR);
}

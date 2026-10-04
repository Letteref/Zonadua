/**
 * Post-generation check: does every number in the model's reply exist in its context?
 *
 * ## Why this is a separate step and not a prompt instruction
 *
 * The M5 DoD asks for "prompt + verification that the figures appear in the context" —
 * two mechanisms, not one. A prompt can *ask* a model not to invent; this checks whether
 * it did. Asking and verifying are different jobs, and only the second one has an exit
 * code.
 *
 * The rule is deliberately blunt: extract every number the reply states, and require each
 * to be traceable to a figure in the rendered context. That is stricter than "the number
 * is plausible" and much stricter than "the number looks right" — but it is the only test
 * that catches a model quietly turning 275 W into 315 W, which is the failure that
 * matters, because a rider trusts a specific number and a vague one is not actionable.
 *
 * The check runs on the reply, never on the prompt: the prompt is ours and is trusted by
 * construction.
 */

/** Numbers that are structure rather than claims, and so are not checked. */
const IGNORED = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 30, 60, 100, 365, 1000
]);

/**
 * Pull the numeric literals out of a piece of text.
 *
 * Deliberately crude: it reads digit runs with an optional decimal, and it keeps the sign
 * out. A model that writes "−7" and one that writes "7" must compare equal, or a
 * correctly-grounded reply would fail purely on typography — and a check that cries wolf
 * on correct answers gets switched off, which is worse than having no check.
 */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  // a digit run, optionally preceded by a decimal point (".5") and optionally with
  // thousands separators ("1,450") so a formatted figure still reads as one number
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/,/g, '');
    const value = Number(raw);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Does `value` match something the context stated, allowing for rounding? */
function isGrounded(value: number, grounded: readonly number[], tolerance: number): boolean {
  if (IGNORED.has(value)) return true;
  // a model that rounds 274.6 to 275 has not invented anything, so compare relatively
  for (const g of grounded) {
    const scale = Math.max(1, Math.abs(g));
    if (Math.abs(value - g) <= tolerance * scale) return true;
  }
  return false;
}

export interface VerifyOptions {
  /**
   * Relative tolerance for a match, as a fraction. 0.005 is half a percent: wide enough
   * to forgive the rounding every model does, far too narrow to let 275 become 315.
   */
  tolerance?: number;
}

export interface Verification {
  /** every number the reply stated */
  stated: number[];
  /** numbers that matched something in the context */
  grounded: number[];
  /** numbers that did not — each is either an invention or a rounding error */
  ungrounded: number[];
  /** true when nothing in the reply is unsupported */
  ok: boolean;
}

/**
 * Check a reply against the context it was given.
 *
 * Returns the offending numbers rather than a bare boolean, so the UI can say *which*
 * figure failed. "This response contained an unsupported number" is not actionable;
 * "312 W is not in your context" is.
 */
export function verifyNumbers(
  reply: string,
  contextText: string,
  options: VerifyOptions = {}
): Verification {
  const tolerance = options.tolerance ?? 0.005;
  const grounded = extractNumbers(contextText);
  const stated = extractNumbers(reply);
  const ungrounded = stated.filter((v) => !isGrounded(v, grounded, tolerance));

  return {
    stated,
    grounded: stated.filter((v) => !ungrounded.includes(v)),
    ungrounded,
    ok: ungrounded.length === 0
  };
}

/**
 * A sentence that replaces a reply which failed verification.
 *
 * The point is not to retry — a second sample is another coin flip. The point is that a
 * reply containing an invented number must never reach the rider dressed as their own
 * data, so it is withheld and the failure is stated plainly.
 */
export function rejectionNotice(ungrounded: readonly number[]): string {
  const listed = ungrounded.map((n) => `${n}`).join(', ');
  return `This response quoted a figure that is not in your data (${listed}), so it was withheld. Nothing here is made up — try asking again, or check the context it was given.`;
}

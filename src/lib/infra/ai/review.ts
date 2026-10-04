/**
 * The review gate: prompt in, verified answer out.
 *
 * ## Why this is a function and not two lines in the route
 *
 * Because pairing the prompt with the right verification target is the whole point of
 * the gate, and it is easy to get wrong in a way no compiler catches. The two documents
 * are *not* interchangeable: `renderContext` prints derived figures the raw context
 * object never holds — moving time in minutes where the field is seconds, the words
 * "not measured" where the field is `null`. Verify against the object and every honest
 * answer that restates a figure from the prompt gets blocked.
 *
 * Kept here, the pairing is a single expression that the tests exercise directly. Left
 * inline in a Svelte file, it is one refactor away from silently comparing the model
 * against the wrong document — and the symptom is a gate that cries wolf, which is worse
 * than having no gate because the rider learns to dismiss it.
 */

import { weeklyReviewPrompt, systemPrompt } from './prompts';
import { verifyNumbers, type Verification } from './verify';
import type { CoachContext } from './context';

export interface ReviewRequest {
  prompt: string;
  system: string;
}

export interface ReviewResult extends Verification {
  /** the reply, but only when every number in it is traceable to the prompt */
  text: string | null;
}

/** Build the exact pair that `verifyReview` will later check the answer against. */
export function buildWeeklyReview(ctx: CoachContext): ReviewRequest {
  return { prompt: weeklyReviewPrompt(ctx), system: systemPrompt() };
}

/**
 * Verify a reply against the prompt that produced it.
 *
 * Returns `text: null` when anything in the reply is ungrounded — the caller must not
 * render a blocked answer, not even partially, and must not fall back to showing it with
 * a warning, because a number the rider reads at 5am has to be trustworthy or absent.
 */
export function verifyReview(request: ReviewRequest, reply: string): ReviewResult {
  const result = verifyNumbers(reply, request.prompt);
  return { ...result, text: result.ok ? reply : null };
}
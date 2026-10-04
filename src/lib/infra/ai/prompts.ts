/**
 * Prompt templates for AI Coach.
 *
 * ## Why this file exists
 *
 * The context builder produces a JSON block of verified numbers. The prompts wrap that
 * block in instructions that tell the model: use only what is there, derive nothing,
 * and if a number is missing, say "not enough data" rather than guessing.
 *
 * ## Anti-hallucination
 *
 * The system prompt is strict because riders make decisions at 5am before 200 km events.
 * A plausible-looking CTL that came from a model's prior would be worse than no number.
 */

import { renderContext, type CoachContext } from './context';

export function systemPrompt(): string {
  return `You are a cycling coach. You answer questions about the rider's training data.

Rules you must follow:
- Every number you mention must appear verbatim in the context block the rider provides.
- If a number you need is missing or null, write "not enough data" — never estimate.
- Round only for readability (e.g. 274.6 → 275). Do not invent precision.
- You may explain what a metric means, but do not give training advice that depends on numbers you do not have.
- Be concise. Two short paragraphs maximum for a weekly review.

The rider is reading your words before a ride. If you are unsure, say so.`;
}

export function weeklyReviewPrompt(ctx: CoachContext): string {
  const contextBlock = renderContext(ctx);
  return `${contextBlock}

Write a 2-paragraph weekly review for this rider. Mention the key numbers and what they mean for next week's training.`;
}

export function raceBriefingPrompt(ctx: CoachContext): string {
  const contextBlock = renderContext(ctx);
  return `${contextBlock}

Write a brief race-day briefing (2 paragraphs). Focus on execution, not theory.`;
}

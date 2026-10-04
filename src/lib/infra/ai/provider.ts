/**
 * Provider adapter for BYO-key LLM calls.
 *
 * ## Why this file exists
 *
 * M5 ships AI features. The rider brings their own key; we never proxy it. The adapter
 * abstracts the two endpoints we actually call (generateContent for Gemini, chat/completions
 * for OpenAI-compatible) and normalises their responses into `{ text, usage }`.
 *
 * ## Security
 *
 * Keys are stored in IndexedDB via `appSettings`, never in localStorage, and sent only to
 * the provider the rider selected. This file makes no network calls without a key.
 */

import { appSettings } from '$lib/data/queries.svelte';

export type Provider = 'gemini' | 'openai' | 'openrouter' | 'anthropic';

export interface LlmResponse {
  text: string;
  usage?: { input: number; output: number };
}

/**
 * How long to wait before giving up on a provider.
 *
 * Without this a request can hang indefinitely — a phone in a tunnel, a proxy that
 * never answers — and the Coach button would spin on "Reading your week…" forever
 * with no way out. Long enough for a slow 2k-token generation, short enough that
 * the rider is not left staring at a spinner.
 */
const TIMEOUT_MS = 45_000;

const ENDPOINTS: Record<Provider, (key: string) => { url: string; headers: HeadersInit; body: unknown }> = {
  gemini: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    headers: { 'Content-Type': 'application/json' },
    body: {}
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: {}
  }),
  openrouter: (key) => ({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://zonadua.app',
      'X-Title': 'Zonadua'
    },
    body: {}
  }),
  anthropic: (key) => ({
    // Anthropic uses a different API shape; we treat it as OpenAI-compatible via their messages endpoint
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: {}
  })
};

/**
 * Call the configured LLM with a prompt. Returns the text response and usage.
 * Throws on network error, 4xx, or malformed response.
 */
export async function generate(prompt: string, systemPrompt: string): Promise<LlmResponse> {
  const settings = appSettings.current;
  if (!settings?.aiKey) {
    throw new Error('No API key saved. Add one in Settings.');
  }

  const provider = (settings.aiProvider as Provider) || 'gemini';
  const key = settings.aiKey;

  const base = ENDPOINTS[provider](key);

  // Build request body per provider
  const body =
    provider === 'gemini'
      ? {
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.7 }
        }
      : provider === 'anthropic'
        ? {
            model: 'claude-3-haiku-20240307',
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: 'user', content: prompt }]
          }
        : {
            model: provider === 'openrouter' ? 'anthropic/claude-3-haiku' : 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7
          };

  const res = await fetch(base.url, {
    method: 'POST',
    headers: base.headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${provider} API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();

  // Normalise response
  if (provider === 'gemini') {
    const cand = json.candidates?.[0];
    const text = cand?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    const usage = json.usageMetadata ? { input: json.usageMetadata.promptTokenCount, output: json.usageMetadata.candidatesTokenCount } : undefined;
    return { text, usage };
  }

  if (provider === 'anthropic') {
    const text = json.content?.map((b: { text?: string }) => b.text ?? '').join('') ?? '';
    const usage = json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : undefined;
    return { text, usage };
  }

  // OpenAI / OpenRouter
  const text = json.choices?.[0]?.message?.content ?? '';
  const usage = json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : undefined;
  return { text, usage };
}

import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude access. Default model: claude-opus-5-5 (override with KEPT_AI_MODEL,
 * e.g. claude-haiku-5-5 for lower cost). Kept treats every model output as
 * untrusted: extraction goes through the deterministic validator and remedies
 * through the policy engine; the model never sees or produces payment state.
 *
 * Server-side refusal fallback is enabled (betas server-side-fallback-2026-07-01,
 * fallbacks: "default"); a final `stop_reason: "refusal"` is treated as failure
 * and Kept falls back to its deterministic path.
 */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return process.env.KEPT_AI_MODEL || "claude-opus-5-5";
}

let client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Model ids that accept the server-side `fallbacks: "default"` parameter. */
export function supportsServerFallback(model: string): boolean {
  return ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"].includes(model);
}

/**
 * Production startup checks. Called from `instrumentation.ts` before the app serves a request.
 *
 * These are the failures that must not be discovered by an attacker:
 *
 *   • human authentication not configured, or a development bypass enabled;
 *   • gateway private keys that would be stored without encryption;
 *   • a simulated rail selected in production.
 *
 * Development is untouched: none of these conditions is fatal outside `NODE_ENV=production`.
 */
import { assertAuthConfigured } from "../auth/config";
import { assertKeyProtection } from "../keystore";

export type StartupProblem = { code: string; detail: string };

/** Every production problem, without throwing. Useful for a health page and for tests. */
export function productionSecurityProblems(env: NodeJS.ProcessEnv = process.env): StartupProblem[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: StartupProblem[] = [];

  try {
    assertAuthConfigured(env);
  } catch (e) {
    problems.push({ code: "AUTH_NOT_CONFIGURED", detail: (e as Error).message });
  }

  try {
    assertKeyProtection(env);
  } catch (e) {
    problems.push({ code: "KEYS_NOT_PROTECTED", detail: (e as Error).message });
  }

  // Belt and braces: the two bypass variables are refused by assertAuthConfigured as well, but a deployment that
  // sets only one of them must still be caught.
  if (env.AUTH_DEV_BYPASS === "1" || env.ENVELOPE_DEV_AUTH === "1") {
    problems.push({ code: "DEV_AUTH_BYPASS", detail: "A development authentication bypass is enabled in production." });
  }

  if ((env.ENVELOPE_RAIL_PROVIDER ?? "paypal").trim().toLowerCase() === "mock") {
    problems.push({ code: "MOCK_RAIL_IN_PRODUCTION", detail: "The mock rail is a deterministic test double; it moves no money and must not be selected in production." });
  }

  return problems;
}

/** Throw when this deployment must not serve. */
export function assertProductionSecurity(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionSecurityProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    "Refusing to start: " + problems.map((p) => `${p.code}: ${p.detail}`).join(" "),
  );
}

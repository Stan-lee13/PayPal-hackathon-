/**
 * Next.js startup hook. Production refuses to serve with an unconfigured identity provider, unsealed gateway
 * keys, a development authentication bypass, or the simulated rail. See lib/security/startup.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionSecurity } = await import("./lib/security/startup");
  assertProductionSecurity();
}

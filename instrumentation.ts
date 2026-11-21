/**
 * Next.js startup hook. Production refuses to serve with an unconfigured identity provider, unsealed gateway
 * keys, a development authentication bypass, or the simulated rail (lib/security/startup.ts), and with a tenant
 * isolation it cannot prove: no request role, a role that can bypass row level security, or policies that are
 * not enabled (lib/security/tenant-role.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionSecurity } = await import("./lib/security/startup");
  assertProductionSecurity();
  if (process.env.NODE_ENV === "production") {
    const { assertTenantRole } = await import("./lib/security/tenant-role");
    await assertTenantRole();
  }
}

/** What the attack corpus needs from the app: the gateway, the simulator, and a way to start clean. */
export async function corpusDeps() {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  return {
    G, B, sim,
    read: async (path: string, params: Record<string, string>, body: unknown) => { const { handlers } = await import("../lib/api/handlers"); return handlers[path]!({ params, body }); },
    capturedOf: async (rootId: string) => (await getDb().query.roots.findFirst({ where: eq(schema.roots.id, rootId) }))?.capturedMinor ?? -1,
    balanceOf: async (agent: string) => (await getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, agent) }))?.balanceMinor ?? -1,
    reset: async () => {
      resetSimMemory();
      G.forgetGatewayKey();
      await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
    },
    db: { expirePromise: async (id: string) => { await getDb().update(schema.spends).set({ promiseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.spends.id, id)); } },
  };
}

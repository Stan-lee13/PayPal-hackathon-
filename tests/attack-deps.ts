/** What the attack corpus needs from the app: the gateway, the simulator, and a way to start clean. */
export async function corpusDeps() {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  return {
    G, sim,
    reset: async () => {
      resetSimMemory();
      G.forgetGatewayKey();
      await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts restart identity cascade`);
    },
    db: { expirePromise: async (id: string) => { await getDb().update(schema.spends).set({ promiseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.spends.id, id)); } },
  };
}

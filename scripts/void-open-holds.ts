/**
 * Sandbox housekeeping: void the PayPal holds of envelopes that are still open in this database,
 * for example after an abandoned demo recording. Sandbox only.
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npx tsx scripts/void-open-holds.ts
 */
import { eq } from "drizzle-orm";
import { loadEnv } from "./env";
loadEnv();
const { getDb, closeDb } = await import("../lib/db");
const { roots } = await import("../lib/db/schema");
const { getPayPal, paypalMode } = await import("../lib/paypal/client");
const { getAuthorization, voidAuthorization } = await import("../lib/paypal/payments");
if (paypalMode() !== "sandbox") throw new Error("This script only runs against the PayPal sandbox.");

const open = await getDb().select().from(roots).where(eq(roots.status, "ACTIVE"));
for (const r of open) {
  if (!r.authorizationId || r.authorizationId.startsWith("SIM")) continue;
  try {
    await voidAuthorization(getPayPal(), r.authorizationId, r.id);
    await getDb().update(roots).set({ status: "CLOSED", closedAt: new Date(), closeReason: "voided by housekeeping", releasedMinor: r.limitMinor - r.capturedMinor - r.refundedMinor }).where(eq(roots.id, r.id));
    console.log(r.id, r.authorizationId, "→", (await getAuthorization(getPayPal(), r.authorizationId)).status);
  } catch (e) { console.log(r.id, r.authorizationId, "could not be voided:", String(e).slice(0, 140)); }
}
console.log(`${open.length} open envelope(s) checked.`);
await closeDb();

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "../db";
import { merchants, products, sources } from "../db/schema";
import { DEMO_MERCHANT, DEMO_PRODUCTS, DEMO_SOURCES } from "./merchant-data";

/** Idempotent seed of the demonstration merchant. */
export async function seedDemoMerchant(db: DB) {
  await db.insert(merchants).values({ ...DEMO_MERCHANT }).onConflictDoNothing();
  for (const p of DEMO_PRODUCTS) {
    await db.insert(products).values({ ...p, merchantId: DEMO_MERCHANT.id, currency: DEMO_MERCHANT.currency })
      .onConflictDoUpdate({ target: products.id, set: { priceMinor: p.priceMinor, inStock: p.inStock, description: p.description } });
  }
  for (const s of DEMO_SOURCES) {
    await db.insert(sources).values({ ...s, merchantId: DEMO_MERCHANT.id, orderId: null, sha256: createHash("sha256").update(s.text).digest("hex") })
      .onConflictDoUpdate({ target: sources.id, set: { text: s.text, sha256: createHash("sha256").update(s.text).digest("hex") } });
  }
}

/** Wipe all transactional data (orders, promises, events, remedies, audit). Keeps the merchant. */
export async function resetTransactions(db: DB) {
  await db.execute(sql`truncate table audit_log, refunds, trackers, disputes, remedies, commitments, paypal_events, rate_limits restart identity cascade`);
  await db.execute(sql`delete from sources where order_id is not null`);
  await db.execute(sql`update chat_sessions set order_id = null`);
  await db.execute(sql`delete from orders`);
  await db.execute(sql`delete from chat_sessions`);
  await db.execute(sql`update merchants set demo_clock_offset_ms = 0`);
}

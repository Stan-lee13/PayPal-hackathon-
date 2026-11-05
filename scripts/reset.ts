import { closeDb, getDb } from "../lib/db";
import { resetTransactions, seedDemoMerchant } from "../lib/services/seed";
import { loadEnv } from "./env";

loadEnv();
const db = getDb();
await resetTransactions(db);
await seedDemoMerchant(db);
console.log("Demo data reset: all orders, promises, events and remedies removed; merchant re-seeded.");
await closeDb();

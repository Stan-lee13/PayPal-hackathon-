import { closeDb, getDb } from "../lib/db";
import { resetDemo } from "../lib/services/seed";
import { loadEnv } from "./env";

loadEnv();
await resetDemo(getDb());
console.log("Demo reset: invoices, events and audit trail removed; demo contract re-seeded.");
await closeDb();

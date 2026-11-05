import { closeDb, getDb } from "../lib/db";
import { seedDemoMerchant } from "../lib/services/seed";
import { loadEnv } from "./env";

loadEnv();
await seedDemoMerchant(getDb());
console.log("Seeded Adaeze Studio (demo merchant), products and policy sources.");
await closeDb();

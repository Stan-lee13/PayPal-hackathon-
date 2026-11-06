import { closeDb, getDb } from "../lib/db";
import { seedDemo } from "../lib/services/seed";
import { loadEnv } from "./env";

loadEnv();
await seedDemo(getDb());
console.log("Seeded the demo freelancer, client and contract.");
await closeDb();

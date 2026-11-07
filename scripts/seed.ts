import { closeDb, getDb } from "../lib/db";
import { seedAll } from "../lib/services/seed";
import { loadEnv } from "./env";

loadEnv();
await seedAll(getDb());
console.log("Seeded the demo freelancer, client, contract, company and developers.");
await closeDb();

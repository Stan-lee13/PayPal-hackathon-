import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../lib/db";
import { loadEnv } from "./env";

loadEnv();
await migrate(getDb(), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await closeDb();

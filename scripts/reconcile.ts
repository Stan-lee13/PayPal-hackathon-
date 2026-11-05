import { loadEnv } from "./env";
loadEnv();
const { reconcile } = await import("../lib/services/pipeline");
const { retryEvents } = await import("../lib/services/webhooks");
const { closeDb } = await import("../lib/db");
console.log(JSON.stringify({ events: await retryEvents(), report: await reconcile() }, null, 2));
await closeDb();

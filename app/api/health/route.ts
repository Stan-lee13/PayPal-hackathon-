import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { gatewayRunsInBrowser } from "@/lib/deployment";
import { json } from "@/lib/http";
import { paypalMode } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

export async function GET() {
  // No server database: pages run the gateway in the visitor's browser against the simulator.
  if (gatewayRunsInBrowser()) return json({ ok: true, gateway: "browser", db: "in the visitor's browser (PGlite)", paypalMode: "simulated" });
  let db = "ok";
  try { await getDb().execute(sql`select 1`); } catch { db = "unreachable"; }
  return json({ ok: db === "ok", gateway: "server", db, paypalMode: paypalMode() });
}

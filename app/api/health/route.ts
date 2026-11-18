import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { gatewayRunsInBrowser } from "@/lib/deployment";
import { json } from "@/lib/http";
import { keysSealed } from "@/lib/keystore";
import { rail, railMode } from "@/lib/rails";

export const dynamic = "force-dynamic";

/**
 * What this deployment is and what its financial rail can actually do. The capabilities and guarantees
 * are read from the rail itself, so this endpoint can never advertise a guarantee the code lacks.
 */
export async function GET() {
  let railInfo: Record<string, unknown>;
  try {
    const r = rail();
    railInfo = { id: r.id, label: r.label, mode: railMode(), capabilities: [...r.capabilities].sort(), guarantees: [...r.guarantees].sort() };
  } catch (e) {
    // An unknown ENVELOPE_RAIL_PROVIDER must be loud, not silently a 200 that moves no money.
    return json({ ok: false, gateway: gatewayRunsInBrowser() ? "browser" : "server", error: `No usable financial rail: ${(e as Error).message}` }, 503);
  }
  // No server database: pages run the gateway in the visitor's browser against the simulator.
  if (gatewayRunsInBrowser()) return json({ ok: true, gateway: "browser", db: "in the visitor's browser (PGlite)", paypalMode: "simulated", rail: railInfo });
  let db = "ok";
  try { await getDb().execute(sql`select 1`); } catch { db = "unreachable"; }
  return json({ ok: db === "ok", gateway: "server", db, paypalMode: railMode(), rail: railInfo, keysAtRest: keysSealed() ? "sealed" : "plain" });
}

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { paypalMode } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "ok";
  try { await getDb().execute(sql`select 1`); } catch { db = "unreachable"; }
  return json({ ok: db === "ok", db, paypalMode: paypalMode() });
}

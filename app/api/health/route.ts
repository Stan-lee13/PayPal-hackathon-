import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { paypalMode } from "@/lib/paypal/client";
import { aiConfigured, aiModel } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "ok";
  try { await getDb().execute(sql`select 1`); } catch { db = "unreachable"; }
  return json({ ok: db === "ok", db, paypalMode: paypalMode(), webhookIdConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID), ai: aiConfigured() ? aiModel() : "not configured (deterministic fallbacks)", demoMode: process.env.DEMO_MODE === "true" });
}

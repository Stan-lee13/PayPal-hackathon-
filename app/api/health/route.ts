import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { paypalMode } from "@/lib/paypal/client";
import { githubMode } from "@/lib/github/client";
import { aiConfigured, aiModel } from "@/lib/ai/client";
import { dailyBudgetUsd, spentTodayUsd } from "@/lib/ai/budget";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "ok";
  try { await getDb().execute(sql`select 1`); } catch { db = "unreachable"; }
  let spent: number | null = null;
  if (db === "ok") { try { spent = Math.round((await spentTodayUsd()) * 10_000) / 10_000; } catch { spent = null; } }
  return json({
    ok: db === "ok", db, paypalMode: paypalMode(), githubMode: githubMode(), webhookIdConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    mcpTokenConfigured: Boolean(process.env.MERGEPAY_MCP_TOKEN),
    ai: aiConfigured() ? aiModel() : "rules only (no Claude key)", aiBudget: { dailyUsd: dailyBudgetUsd(), spentTodayUsd: spent },
  });
}

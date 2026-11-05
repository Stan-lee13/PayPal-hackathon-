import { getDb } from "@/lib/db";
import { resetTransactions, seedDemoMerchant } from "@/lib/services/seed";
import { demoModeEnabled } from "@/lib/clock";
import { UserFacingError } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** DEMO_MODE only: wipe demo orders/promises/events so a fresh run can be recorded. */
export async function POST(req: Request) {
  try {
    await requireMerchant(req);
    if (!demoModeEnabled()) throw new UserFacingError("Reset is only available in DEMO_MODE.", 403);
    await resetTransactions(getDb());
    await seedDemoMerchant(getDb());
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

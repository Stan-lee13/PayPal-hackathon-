import { NextResponse } from "next/server";
import { assertOrderOwned } from "@/lib/services/ownership";
import { evidencePack } from "@/lib/services/evidence";
import { errorResponse, requireMerchant } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Download the order's self-verifying evidence pack (merchant only). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    await assertOrderOwned(id, merchantId);
    const pack = await evidencePack(id);
    return new NextResponse(JSON.stringify(pack, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="kept-evidence-${id}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) { return errorResponse(e); }
}

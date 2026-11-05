import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { promiseRecord } from "@/lib/services/promise-record";
import { UserFacingError } from "@/lib/services/orders";
import { clientIp, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Public, read-only, aggregate-only promise record. CORS-open so any agent or page can read it. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!(await rateLimit(getDb(), `record:ip:${clientIp(req)}`, 60, 60))) throw new UserFacingError("Too many requests.", 429);
    const slug = z.string().regex(/^[a-z0-9-]{2,64}$/).parse((await params).slug);
    const r = await promiseRecord(slug);
    if (!r) throw new UserFacingError("No such merchant.", 404);
    return NextResponse.json(r, { headers: { "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*" } });
  } catch (e) { return errorResponse(e); }
}

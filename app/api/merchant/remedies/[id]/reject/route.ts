import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { remedies } from "@/lib/db/schema";
import { rejectRemedy } from "@/lib/services/remedies";
import { UserFacingError } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    const { note } = z.object({ note: z.string().max(300).default("") }).parse(await req.json());
    const owned = await getDb().query.remedies.findFirst({ where: and(eq(remedies.id, id), eq(remedies.merchantId, merchantId)) });
    if (!owned) throw new UserFacingError("Remedy not found.", 404);
    const r = await rejectRemedy(id, note);
    return json({ remedy: { id: r.id, state: r.state } });
  } catch (e) { return errorResponse(e); }
}

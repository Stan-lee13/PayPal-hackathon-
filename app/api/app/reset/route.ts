import { getDb } from "@/lib/db";
import { errorResponse, json, requireFreelancer } from "@/lib/http";
import { resetDemo } from "@/lib/services/seed";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireFreelancer(req);
    await resetDemo(getDb());
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

import { z } from "zod";
import { errorResponse, json } from "@/lib/http";
import { announce } from "@/lib/gateway/service";

export const dynamic = "force-dynamic";

/** Tell the gateway about a split so the owner can see and revoke it. Optional: splits verify without it. */
export async function POST(req: Request) {
  try {
    const { chain } = z.object({ chain: z.array(z.any()).min(2).max(8) }).parse(await req.json());
    return json(await announce(chain));
  } catch (e) { return errorResponse(e); }
}

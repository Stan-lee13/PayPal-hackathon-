import { z } from "zod";
import { errorResponse, json } from "@/lib/http";
import { revoke } from "@/lib/gateway/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Revoke an envelope (signed by the owner or by a holder above it). Revoking the root closes it and releases the PayPal hold. */
export async function POST(req: Request) {
  try {
    const { signed } = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }) }).parse(await req.json());
    const r = await revoke(signed as never);
    return json({ block: { id: r.block.id, revokedAt: r.block.revokedAt }, root: { status: r.root.status, capturedMinor: r.root.capturedMinor, releasedMinor: r.root.releasedMinor } });
  } catch (e) { return errorResponse(e); }
}

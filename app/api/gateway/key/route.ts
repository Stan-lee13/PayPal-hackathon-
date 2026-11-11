import { errorResponse, json } from "@/lib/http";
import { gatewayKey } from "@/lib/gateway/service";

export const dynamic = "force-dynamic";

/** The gateway's public key, so receipts and statements of standing can be checked offline. */
export async function GET() {
  try { return json({ publicKey: (await gatewayKey()).publicKey, signs: ["envelope-receipt/1", "envelope-standing/1"] }); }
  catch (e) { return errorResponse(e); }
}

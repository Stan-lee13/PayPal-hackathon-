import { NextResponse } from "next/server";
import { completeFunding } from "@/lib/services/bounties";
import { appBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

/** PayPal sends the company back here after approving: authorize the order, then show the bounty. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    await completeFunding(id, token);
    return NextResponse.redirect(`${appBaseUrl()}/bounties/${id}?funded=1`, 303);
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message.slice(0, 300) : "Funding failed.");
    return NextResponse.redirect(`${appBaseUrl()}/bounties/${id}?error=${msg}`, 303);
  }
}

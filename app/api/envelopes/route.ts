import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route("GET /api/envelopes");
/** Seal: register a root envelope signed by the principal; the gateway places the PayPal hold. */
export const POST = route("POST /api/envelopes", { limit: ["seal", 12, 3600], global: ["seal", 120, 3600] });

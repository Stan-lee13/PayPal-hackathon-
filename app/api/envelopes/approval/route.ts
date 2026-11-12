import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Start a seal the payer approves in PayPal's own checkout. Nothing is held or recorded until they do. */
export const POST = route("POST /api/envelopes/approval", { limit: ["seal", 12, 3600], global: ["seal", 120, 3600] });

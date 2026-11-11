import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route("GET /api/envelopes/:id/paypal", { limit: ["rail", 600, 600] });

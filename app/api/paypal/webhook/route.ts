import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PayPal calls this. Every event is verified with PayPal before anything is done with it.
export const POST = route("POST /api/paypal/webhook", { global: ["webhook", 3000, 600] });

import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";

/** Simulator only: the simulated payer approves an order in the simulated checkout. */
export const POST = route("POST /api/sim/paypal/approve", { limit: ["sim-approve", 60, 3600], sameOrigin: true });

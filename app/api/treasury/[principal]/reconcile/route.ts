import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/treasury/:principal/reconcile", { limit: ["reconcile", 30, 600] });

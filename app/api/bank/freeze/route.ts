import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/bank/freeze", { limit: ["freeze", 60, 600] });

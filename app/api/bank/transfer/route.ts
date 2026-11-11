import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/bank/transfer", { limit: ["transfer", 120, 600] });

import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route("GET /api/bank/statement", { limit: ["statement", 20, 600] });

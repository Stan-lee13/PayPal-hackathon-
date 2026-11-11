import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route("GET /api/proof/:root", { limit: ["proof", 240, 600] });

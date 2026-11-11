import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route("GET /api/spends/:id/status", { limit: ["status", 600, 600] });

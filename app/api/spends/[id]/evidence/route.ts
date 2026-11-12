import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route("GET /api/spends/:id/evidence", { limit: ["evidence", 300, 600] });

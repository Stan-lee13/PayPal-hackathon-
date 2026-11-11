import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/gateway/standing", { limit: ["standing", 120, 600] });

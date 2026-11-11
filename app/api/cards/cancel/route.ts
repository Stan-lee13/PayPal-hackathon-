import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/cards/cancel", { limit: ["cardcancel", 60, 600] });

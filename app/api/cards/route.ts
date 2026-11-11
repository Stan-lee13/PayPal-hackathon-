import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/cards", { limit: ["cards", 60, 3600] });

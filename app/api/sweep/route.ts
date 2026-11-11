import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/sweep", { limit: ["sweep", 12, 60], global: ["sweep-all", 120, 600] });

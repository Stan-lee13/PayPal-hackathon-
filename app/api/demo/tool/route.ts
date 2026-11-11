import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/demo/tool", { sameOrigin: true, limit: ["demotool", 300, 3600] });

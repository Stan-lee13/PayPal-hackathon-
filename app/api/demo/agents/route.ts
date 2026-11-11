import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/demo/agents", { sameOrigin: true, limit: ["demoagents", 30, 3600] });

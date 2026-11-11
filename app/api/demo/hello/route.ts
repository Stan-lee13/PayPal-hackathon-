import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/demo/hello", { sameOrigin: true, limit: ["demohello", 120, 3600] });

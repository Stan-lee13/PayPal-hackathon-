import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/demo/act", { sameOrigin: true, limit: ["demoact", 240, 3600] });

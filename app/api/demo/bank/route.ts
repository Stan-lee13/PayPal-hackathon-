import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/demo/bank", { sameOrigin: true, browserOnly: true, limit: ["demobank", 120, 3600] });

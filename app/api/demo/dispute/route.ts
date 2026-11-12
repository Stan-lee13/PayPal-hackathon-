import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/demo/dispute", { sameOrigin: true, browserOnly: true, limit: ["demodispute", 40, 3600] });

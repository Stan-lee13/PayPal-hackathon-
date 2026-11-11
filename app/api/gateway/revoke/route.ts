import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/gateway/revoke", { limit: ["revoke", 120, 600] });

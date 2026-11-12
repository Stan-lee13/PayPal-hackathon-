import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route("POST /api/auditor/check", { limit: ["auditor-check", 120, 600] });

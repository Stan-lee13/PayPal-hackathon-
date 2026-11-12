import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("POST /api/auditor/read", { limit: ["auditor-read", 120, 600], global: ["auditor-read", 3000, 3600] });

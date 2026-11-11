import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route("GET /api/treasury/:principal");

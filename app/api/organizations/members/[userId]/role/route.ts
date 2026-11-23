import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";

export const POST = route("POST /api/organizations/members/:userId/role", { limit: ["member-admin", 60, 3600] });

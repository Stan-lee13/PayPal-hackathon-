import { route } from "@/lib/api/next";

export const dynamic = "force-dynamic";

export const POST = route("POST /api/organizations/invitations/:id/revoke");

"use client";

import { useRouter } from "next/navigation";

export function SignOut() {
  const router = useRouter();
  return <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await fetch("/api/app/logout", { method: "POST" }); router.push("/app/login"); }}>Sign out</button>;
}

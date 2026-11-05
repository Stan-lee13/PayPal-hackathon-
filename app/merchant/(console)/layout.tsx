import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { currentMerchant } from "@/lib/security/session";
import { getDb } from "@/lib/db";
import { merchants } from "@/lib/db/schema";
import { ModeBanner } from "@/components/mode-banner";
import { demoModeEnabled } from "@/lib/clock";
import { ConsoleTools } from "./console-tools";
import { paypalMode } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const merchantId = await currentMerchant();
  if (!merchantId) redirect("/merchant/login");
  const m = await getDb().query.merchants.findFirst({ where: eq(merchants.id, merchantId) });
  if (!m) redirect("/merchant/login");
  const offsetH = demoModeEnabled() ? Math.round(m.demoClockOffsetMs / 3600_000) : 0;
  return (
    <>
      <ModeBanner simulatedClockHours={offsetH} />
      <header className="rule-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/merchant" className="quote text-2xl">Kept</Link>
          <span className="text-sm text-ink-soft">{m.name}</span>
          <nav aria-label="Merchant" className="flex flex-wrap gap-4 text-sm font-semibold">
            <Link href="/merchant">Promises</Link>
            <Link href="/merchant/orders">Orders</Link>
            <Link href="/merchant/activity">Activity</Link>
            <Link href="/merchant/settings">Settings</Link>
            <Link href="/store" className="text-ink-soft">Store ↗</Link>
          </nav>
          <div className="ml-auto"><ConsoleTools demo={demoModeEnabled()} simulated={paypalMode() === "simulated"} offsetHours={offsetH} /></div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}

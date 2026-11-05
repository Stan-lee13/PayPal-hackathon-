"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/merchant", "Promises"], ["/merchant/orders", "Orders"], ["/merchant/analytics", "Intelligence"], ["/merchant/activity", "Activity"], ["/merchant/settings", "Settings"],
] as const;

/** Merchant navigation with a clear current-page marker (no motion: used constantly). */
export function ConsoleNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/merchant" ? path === "/merchant" : path.startsWith(href));
  return (
    <nav aria-label="Merchant" className="flex flex-wrap gap-1 text-sm font-semibold">
      {LINKS.map(([href, label]) => {
        const on = active(href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 ${on ? "bg-[var(--paper-raised)] text-ink shadow-[var(--shadow-sm)] ring-1 ring-[var(--hairline)]" : "text-ink-soft hover:text-ink"}`}>{label}</Link>
        );
      })}
      <Link href="/store" className="rounded-md px-2.5 py-1.5 text-ink-soft hover:text-ink">Store ↗</Link>
    </nav>
  );
}

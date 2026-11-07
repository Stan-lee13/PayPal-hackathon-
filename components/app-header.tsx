import Link from "next/link";
import { SignOut } from "./sign-out";

export function AppHeader({ current }: { current: "invoices" | "connect" }) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">Merge<span className="text-accent">Pay</span></Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link className="btn btn-ghost btn-sm" aria-current={current === "invoices" ? "page" : undefined} href="/app">Invoices</Link>
          <Link className="btn btn-ghost btn-sm" aria-current={current === "connect" ? "page" : undefined} href="/connect">Connect editor</Link>
          <Link className="btn btn-ghost btn-sm" href="/demo">Demo</Link>
          <SignOut />
        </nav>
      </div>
    </header>
  );
}

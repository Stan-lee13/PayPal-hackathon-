import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true"><rect x="1" y="1" width="20" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M2 3l9 7 9-7" fill="none" stroke="var(--accent)" strokeWidth="1.6" /></svg>
        Envelope
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        <Link className="btn btn-ghost btn-sm" href="/#how">How it works</Link>
        <Link className="btn btn-ghost btn-sm" href="/spec">Protocol</Link>
        <Link className="btn btn-sm" href="/console">Console</Link>
      </nav>
    </header>
  );
}

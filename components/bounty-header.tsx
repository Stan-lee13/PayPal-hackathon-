import Link from "next/link";
import { PersonaSwitch } from "./persona-switch";

export function BountyHeader({ persona }: { persona: string }) {
  return (
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="flex items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight">Merge<span className="text-accent">Pay</span></Link>
        <nav className="flex gap-1 text-sm"><Link className="btn btn-ghost btn-sm" href="/bounties">Bounties</Link><Link className="btn btn-ghost btn-sm" href="/demo">Invoicing demo</Link></nav>
      </div>
      <PersonaSwitch current={persona} />
    </header>
  );
}

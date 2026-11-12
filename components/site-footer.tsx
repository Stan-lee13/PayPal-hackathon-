import Link from "next/link";
import { SITE } from "@/lib/site-map";

/** The same map as the menu, at the foot of every page: wherever a visitor ends up, every other part is one step away. */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-[1.5px] border-ink bg-sheet" data-testid="site-footer">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <p className="title text-[1.25rem]">One system, seen from different sides.</p>
        <p className="mt-1 max-w-2xl text-[.9rem] text-ink-2">An envelope, an account, a card, a receipt and the books are the same money at different moments. Every page below is a view of it.</p>
        <nav aria-label="Site map" className="mt-7 grid grid-cols-2 gap-x-8 gap-y-7 lg:grid-cols-4">
          {SITE.map((g) => (
            <div key={g.group}>
              <p className="label">{g.group}</p>
              <ul className="mt-2 space-y-1.5">
                {g.places.map((p) => <li key={p.href}><Link className="link text-[.92rem]" href={p.href}>{p.name}</Link></li>)}
              </ul>
            </div>
          ))}
        </nav>
        <p className="mt-8 text-[.78rem] text-ink-3">Envelope is a hackathon entry running on the PayPal sandbox and a built-in simulator. It is not a bank, an escrow service or a card issuer, and no real money moves.</p>
      </div>
    </footer>
  );
}

import Link from "next/link";
import { SiteMenu } from "./site-menu";
import { Wordmark } from "./stationery";

/** A short row of the places used most, and a menu that holds every page. On a phone the menu is the navigation. */
export function SiteHeader() {
  return (
    <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-2 px-5 pb-5 pt-5">
      <Link href="/" aria-label="Envelope, home"><Wordmark /></Link>
      <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] lg:inline-flex" href="/treasury">Treasury</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] md:inline-flex" href="/bank">Accounts</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] md:inline-flex" href="/cards">Cards</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] md:inline-flex" href="/auditor">Auditor</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] lg:inline-flex" href="/developers">Developers</Link>
        <SiteMenu />
        <Link className="btn btn-sm !min-h-[34px] !px-3 !text-[.84rem]" href="/console">Seal<span className="hidden sm:inline">&nbsp;an envelope</span></Link>
      </nav>
    </header>
  );
}

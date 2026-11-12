import Link from "next/link";
import { Wordmark } from "./stationery";

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 pb-5 pt-5">
      <Link href="/" aria-label="Envelope, home"><Wordmark /></Link>
      <nav className="flex items-center gap-1 sm:gap-2">
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] sm:inline-flex" href="/#account">How it works</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] sm:inline-flex" href="/spec">Protocol</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] md:inline-flex" href="/developers">Developers</Link>
        <Link className="btn btn-quiet btn-sm !text-[.84rem]" href="/bank">Accounts</Link>
        <Link className="btn btn-quiet btn-sm !text-[.84rem]" href="/treasury">Treasury</Link>
        <Link className="btn btn-quiet btn-sm hidden !text-[.84rem] sm:inline-flex" href="/auditor">Auditor</Link>
        <Link className="btn btn-sm !min-h-[34px] !px-3 !text-[.84rem]" href="/console">Seal an envelope</Link>
      </nav>
    </header>
  );
}

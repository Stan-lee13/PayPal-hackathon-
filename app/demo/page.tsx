import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { paypalMode } from "@/lib/paypal/client";
import { githubMode } from "@/lib/github/client";
import { Playground } from "./playground";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live demo" };

export default function DemoPage() {
  return (
    <>
      <ModeBanner />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight">Merge<span className="text-accent">Pay</span></Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link className="btn btn-ghost btn-sm" href="/#how">How it works</Link>
          <Link className="btn btn-ghost btn-sm" href="/connect">Connect your editor</Link>
          <Link className="btn btn-sm" href="/app">Dashboard</Link>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <div className="mb-5 max-w-3xl">
          <h1 className="text-2xl font-semibold sm:text-3xl">Bill a pull request, get paid, watch it merge</h1>
          <p className="mt-1.5 text-ink-soft">
            This is the conversation you&rsquo;d have with the agent in Cursor or Claude Code. Every step calls the same MergePay tools over MCP: the requests are shown under each reply.
          </p>
        </div>
        <Playground paypal={paypalMode()} github={githubMode()} />
      </main>
    </>
  );
}

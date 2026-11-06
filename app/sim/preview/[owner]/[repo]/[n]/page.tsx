import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { githubMode } from "@/lib/github/client";

export const metadata: Metadata = { title: "Preview deployment (simulated)", robots: { index: false } };

/** What the client checks before paying: a stand-in for the PR's preview deployment (e.g. Vercel). */
export default async function SimPreview({ params }: { params: Promise<{ owner: string; repo: string; n: string }> }) {
  const { owner, repo, n } = await params;
  if (githubMode() !== "simulated") notFound();
  return (
    <main id="main" className="min-h-dvh bg-[#FBF6EF] text-[#2B1D12]">
      <p className="bg-[#2B1D12] px-4 py-1.5 text-center text-xs text-[#FBF6EF]">Preview of {owner}/{repo} pull request #{n} · simulated deployment</p>
      <nav className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-8">
        <span className="text-lg font-bold">Lagos Roast</span>
        <span className="flex flex-wrap gap-3 text-sm max-[375px]:gap-2"><span>Beans</span><span>Brewing</span><span>About</span><span aria-label="Cart, 2 items">🛒 2</span></span>
      </nav>
      <section className="mx-auto max-w-md px-4 py-8">
        <h1 className="text-2xl font-bold">Your cart</h1>
        <ul className="mt-4 divide-y divide-[#2B1D12]/15 rounded-xl bg-white p-4 text-sm">
          <li className="flex justify-between py-2"><span>Ofada Dark Roast · 500g</span><span>$18.00</span></li>
          <li className="flex justify-between py-2"><span>Jos Plateau Light · 250g</span><span>$11.50</span></li>
          <li className="flex justify-between py-2 font-semibold"><span>Total</span><span>$29.50</span></li>
        </ul>
        <div className="mt-4 rounded-xl border-2 border-dashed border-[#2B1D12]/30 p-4 text-center text-sm">
          [ Pay with PayPal — $29.50 ]<p className="mt-1 text-xs opacity-70">The new checkout button from this PR (preview only)</p>
        </div>
      </section>
    </main>
  );
}

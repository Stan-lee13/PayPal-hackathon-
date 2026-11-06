import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, contracts, invoices } from "@/lib/db/schema";
import { json, errorResponse } from "@/lib/http";
import { DEMO_CONTRACT_ID } from "@/lib/services/seed";
import { invoiceView } from "@/lib/services/views";
import { githubMode, getGitHub } from "@/lib/github/client";
import { paypalMode } from "@/lib/paypal/client";
import { appBaseUrl } from "@/lib/base-url";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Everything the playground shows, for one PR: the contract, the PR, its live invoice and the PR's comments. */
export async function GET(req: Request) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const c = await db.query.contracts.findFirst({ where: eq(contracts.id, DEMO_CONTRACT_ID) });
    if (!c) return json({ error: "Demo not seeded." }, 503);
    const client = (await db.query.clients.findFirst({ where: eq(clients.id, c.clientId) }))!;
    const latest = await db.query.invoices.findFirst({ where: eq(invoices.contractId, c.id), orderBy: desc(invoices.createdAt) });
    const prNo = Number(url.searchParams.get("pr") ?? 0) || (githubMode() === "simulated" ? await latestSimPr(c.repo) : latest?.prNumber ?? 0);
    const inv = prNo ? await db.query.invoices.findFirst({ where: and(eq(invoices.repo, c.repo), eq(invoices.prNumber, prNo), ne(invoices.status, "CANCELLED")) }) : undefined;
    let pr: unknown = null;
    if (prNo) {
      if (githubMode() === "simulated") {
        const { simPullSnapshot } = await import("@/lib/github/emulator");
        const { withSimState } = await import("@/lib/sim/store");
        const p = await withSimState(() => simPullSnapshot(c.repo, prNo));
        pr = p && { number: p.number, title: p.title, state: p.state, merged: p.merged, headSha: p.headSha, url: `${appBaseUrl()}/sim/pr/${c.repo}/${p.number}`, comments: p.comments.slice(-4) };
      } else {
        const p = await getGitHub().getPull(c.repo, prNo).catch(() => null);
        pr = p && { number: p.number, title: p.title, state: p.state, merged: p.merged, headSha: p.headSha, url: p.url, comments: [] };
      }
    }
    return json({
      modes: { paypal: paypalMode(), github: githubMode() },
      contract: { repo: c.repo, title: c.title, client: client.name, company: client.company, clientEmail: client.email, accepted: c.clientAcceptedAt?.toISOString() ?? null, clientLink: `/c/${c.clientToken}`,
        prices: Object.entries(c.issuePrices).map(([k, v]) => ({ issue: k, price: formatMoney(v, c.currency) })) },
      pr,
      invoice: inv ? invoiceView(inv) : null,
    });
  } catch (e) { return errorResponse(e); }
}

async function latestSimPr(repo: string): Promise<number> {
  const { simListPulls } = await import("@/lib/github/emulator");
  const { withSimState } = await import("@/lib/sim/store");
  const open = await withSimState(() => simListPulls(repo).filter((p) => p.state === "open"));
  return open[0]?.number ?? 18;
}

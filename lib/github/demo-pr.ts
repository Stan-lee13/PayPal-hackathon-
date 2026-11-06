/**
 * Live GitHub demo: create two issues, a branch, a few commits and a PR closing both issues in the
 * demo repository (needs a fine-grained token with Contents, Issues and Pull requests: read & write,
 * scoped to that repository only). The PR deliberately also touches analytics code that neither
 * issue asks for, so the scope check has something real to flag.
 */
import { getGitHub, assertRepo } from "./client";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export async function createLiveDemoPullRequest(repo: string): Promise<{ pr: number; issues: number[] }> {
  const gh = getGitHub();
  const r = assertRepo(repo);
  const run = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const info = await gh.request<{ default_branch: string }>("GET", `/repos/${r}`);
  const base = info.default_branch;
  const ref = await gh.request<{ object: { sha: string } }>("GET", `/repos/${r}/git/ref/heads/${encodeURIComponent(base)}`);

  const checkout = await gh.request<{ number: number }>("POST", `/repos/${r}/issues`, {
    title: "Add PayPal checkout to the cart page",
    body: "Customers should be able to pay with PayPal from /cart.\n\nAcceptance criteria:\n- PayPal button on the cart page\n- The amount charged matches the cart total\n- After paying, the customer sees an order confirmation with the order number",
  });
  const nav = await gh.request<{ number: number }>("POST", `/repos/${r}/issues`, {
    title: "Menu overflows on small phones",
    body: "On phones narrower than 375px the top menu runs off the screen and the cart icon can't be tapped.\n\nAcceptance criteria:\n- Menu fits on a 320px screen\n- Cart icon always visible",
  });

  const branch = `mergepay-demo-${run}`;
  await gh.request("POST", `/repos/${r}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha });

  const put = async (path: string, content: string, message: string) => {
    let sha: string | undefined;
    try { sha = (await gh.request<{ sha: string }>("GET", `/repos/${r}/contents/${path}?ref=${encodeURIComponent(branch)}`)).sha; } catch { sha = undefined; }
    await gh.request("PUT", `/repos/${r}/contents/${path}`, { message, content: b64(content), branch, ...(sha ? { sha } : {}) });
  };
  await put("components/paypal-button.tsx", `// demo run ${run}\nexport function PayPalButton({ amount, currency }: { amount: string; currency: string }) {\n  // createOrder uses the cart total; onApprove captures and redirects to /checkout/success\n  return <div data-amount={amount} data-currency={currency} id="paypal-button" />;\n}\n`, "Add PayPal Smart Button to the cart page");
  await put("app/checkout/success/page.tsx", `// demo run ${run}\nexport default function Success({ searchParams }: { searchParams: { order?: string } }) {\n  return <h1>Thanks! Order {searchParams.order} is confirmed.</h1>;\n}\n`, "Show order confirmation after PayPal approval");
  await put("components/site-nav.tsx", `// demo run ${run}\nexport function SiteNav() {\n  return <nav className="flex flex-wrap gap-4 max-[375px]:gap-2">{/* menu fits on 320px; cart icon always visible */}</nav>;\n}\n`, "Fix menu overflow under 375px; keep cart icon visible");
  await put("lib/analytics.ts", `// demo run ${run}\nexport function trackEvent(e: { name: string; schema: "v2"; [k: string]: unknown }) {\n  console.log("track", e);\n}\n`, "Rewrite analytics events to the new tracking schema");

  const pr = await gh.request<{ number: number }>("POST", `/repos/${r}/pulls`, {
    title: "Add PayPal checkout and fix mobile nav",
    head: branch,
    base,
    body: `Closes #${checkout.number}\nCloses #${nav.number}\n\n- PayPal button on /cart, charged amount taken from the cart total\n- Order confirmation page after approval\n- Menu no longer overflows on small phones\n- Also tidied up analytics events while I was in there\n\n_Created by MergePay's demo generator._`,
  });
  return { pr: pr.number, issues: [checkout.number, nav.number] };
}

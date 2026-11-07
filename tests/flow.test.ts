/**
 * The whole loop against the built-in PayPal and GitHub simulators:
 * draft → (client accepts terms) → send → client pays → webhook → GET → merge exactly the invoiced commit.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("MergePay end to end (simulated PayPal + GitHub)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, asc } = await import("drizzle-orm");
  const { seedDemo, resetDemo, DEMO_CONTRACT_ID } = await import("../lib/services/seed");
  const inv = await import("../lib/services/invoices");
  const { acceptTerms } = await import("../lib/services/contracts");
  const { deliverSimulatedEvents, ingestSimulatedEvent, processEvent } = await import("../lib/services/webhooks");
  const { simPayInvoice } = await import("../lib/paypal/emulator");
  const gh = await import("../lib/github/emulator");
  const { resetSimMemory, withSimState } = await import("../lib/sim/store");
  const { createDemoPullRequest } = await import("../lib/services/demo");
  const { verifyChain } = await import("../lib/ledger/chain");
  const { handleMcp } = await import("../lib/mcp/server");
  const FL = "fl_demo";
  const REPO = "lagosroast/storefront";

  const accept = async () => {
    const c = (await getDb().query.contracts.findFirst({ where: eq(schema.contracts.id, DEMO_CONTRACT_ID) }))!;
    await acceptTerms(c.clientToken, { ip: "test", userAgent: "vitest" });
  };
  const pr = (n: number) => withSimState(() => gh.simPullSnapshot(REPO, n));

  beforeEach(async () => {
    resetSimMemory();
    await seedDemo(getDb());
    await resetDemo(getDb());
  });

  it("drafts from the contract, refuses to send without consent and confirmation, then pays and merges", async () => {
    const draft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 18 });
    expect(draft.status).toBe("DRAFT");
    expect(draft.amountMinor).toBe(53000); // #12 $450 + #14 $80
    expect(draft.scope.outOfScope.flatMap((o) => o.files)).toContain("lib/analytics.ts");
    expect(draft.previewUrl).toMatch(/\/sim\/preview\/lagosroast\/storefront\/18$/);

    await expect(inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true })).rejects.toThrow(/hasn't accepted the merge-on-payment terms/);
    await accept();
    await expect(inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: false })).rejects.toThrow(/Not sent/);

    const sent = await inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true });
    expect(sent.status).toBe("SENT");
    expect(sent.paypalInvoiceId).toMatch(/^INV2-SIM-/);
    expect(sent.payerViewUrl).toMatch(/\/sim\/pay\/INV2-SIM-/);
    expect((await pr(18))!.comments.at(-1)!.body).toMatch(/Invoice MP-0001 sent via PayPal/);

    expect((await simPayInvoice(sent.paypalInvoiceId!)).ok).toBe(true);
    expect(await deliverSimulatedEvents()).toBe(1);

    const done = (await getDb().query.invoices.findFirst({ where: eq(schema.invoices.id, draft.id) }))!;
    expect(done.status).toBe("MERGED");
    expect(done.paidAmountMinor).toBe(53000);
    const p = (await pr(18))!;
    expect(p.merged).toBe(true);
    expect(p.comments.at(-1)!.body).toMatch(/Paid via PayPal.*Merged commit/s);

    // the trail is complete and tamper-evident
    const trail = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.subjectId, draft.id)).orderBy(asc(schema.auditLog.seq));
    expect(trail.map((t) => t.action)).toEqual(["invoice.drafted", "invoice.sent", "invoice.paid", "pr.merged"]);
    const v = verifyChain(FL, draft.id, trail.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) as never);
    expect(v.ok).toBe(true);
  });

  it("does not merge if the PR changed after the invoice was sent", async () => {
    await accept();
    const { pr: n } = await createDemoPullRequest();
    const draft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: n });
    expect(draft.amountMinor).toBe(53000); // the generated issues got the same agreed prices
    const sent = await inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true });
    await withSimState(() => gh.simPushCommit(REPO, n));
    await simPayInvoice(sent.paypalInvoiceId!);
    await deliverSimulatedEvents();
    const after = (await getDb().query.invoices.findFirst({ where: eq(schema.invoices.id, draft.id) }))!;
    expect(after.status).toBe("MERGE_BLOCKED");
    expect(after.blockReason).toMatch(/changed after invoicing/);
    expect((await pr(n))!.merged).toBe(false);
  });

  it("refuses to send a draft whose PR moved", async () => {
    await accept();
    const { pr: n } = await createDemoPullRequest();
    const draft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: n });
    await withSimState(() => gh.simPushCommit(REPO, n));
    await expect(inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true })).rejects.toThrow(/new commits since this draft/);
    const redraft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: n });
    expect(redraft.id).toBe(draft.id);
    expect((await inv.sendInvoice({ freelancerId: FL, invoiceId: redraft.id, confirm: true })).status).toBe("SENT");
  });

  it("never bills the same issue twice, or the same PR twice", async () => {
    await accept();
    const first = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 18 });
    await inv.sendInvoice({ freelancerId: FL, invoiceId: first.id, confirm: true });
    await expect(inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 18 })).rejects.toThrow(/already has invoice MP-0001/);
    // another PR that closes the same issues #12 and #14
    await withSimState(() => {
      const src = gh.simPullSnapshot(REPO, 18)!;
      const copy = structuredClone(src);
      copy.number = 40; copy.headSha = "f".repeat(40); copy.comments = [];
      (globalThis as unknown as { __mergepaySim: { github: { repos: Record<string, { pulls: Record<string, unknown> }> } } }).__mergepaySim.github.repos[REPO]!.pulls["40"] = copy;
    });
    await expect(inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 40 })).rejects.toThrow(/#12 was already billed on invoice MP-0001.*#14 was already billed/s);
  });

  it("ignores duplicate webhook deliveries and only merges once", async () => {
    await accept();
    const draft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 18 });
    const sent = await inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true });
    await simPayInvoice(sent.paypalInvoiceId!);
    const { takeSimOutbox } = await import("../lib/paypal/emulator");
    const [event] = await takeSimOutbox();
    const first = await ingestSimulatedEvent(event!);
    const again = await ingestSimulatedEvent(event!);
    expect(again.body.duplicate).toBe(true);
    await processEvent(first.internalId!);
    // a status check afterwards (e.g. the agent asks) must not merge again or change anything
    const r = await inv.refreshInvoice({ freelancerId: FL, invoiceId: draft.id });
    expect(r.invoice.status).toBe("MERGED");
    expect(r.paypal?.status).toBe("PAID");
    const merges = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, "pr.merged"));
    expect(merges).toHaveLength(1);
  });

  it("a missed webhook is recovered by a status check", async () => {
    await accept();
    const draft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 18 });
    const sent = await inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true });
    await simPayInvoice(sent.paypalInvoiceId!); // the event stays in the outbox, never delivered
    const r = await inv.refreshInvoice({ freelancerId: FL, invoiceId: draft.id });
    expect(r.invoice.status).toBe("MERGED");
  });

  it("works across serverless instances (MERGEPAY_SIM_PERSIST=1)", async () => {
    process.env.MERGEPAY_SIM_PERSIST = "1";
    try {
      await accept();
      const draft = await inv.draftInvoice({ freelancerId: FL, repo: REPO, pr: 18 });
      resetSimMemory();
      const sent = await inv.sendInvoice({ freelancerId: FL, invoiceId: draft.id, confirm: true });
      resetSimMemory();
      await simPayInvoice(sent.paypalInvoiceId!);
      resetSimMemory();
      expect(await deliverSimulatedEvents()).toBe(1);
      const after = (await getDb().query.invoices.findFirst({ where: eq(schema.invoices.id, draft.id) }))!;
      expect(after.status).toBe("MERGED");
    } finally {
      delete process.env.MERGEPAY_SIM_PERSIST;
    }
  });

  it("MCP: lists tools, drafts through tools/call, and refuses to send without confirm", async () => {
    await accept();
    const init = await handleMcp(FL, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect((init!.result as { serverInfo: { name: string } }).serverInfo.name).toBe("mergepay");
    const list = await handleMcp(FL, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((list!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual(["list_contracts", "draft_invoice", "send_invoice", "invoice_status", "list_invoices", "remind_client", "cancel_invoice"]);
    const drafted = await handleMcp(FL, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "draft_invoice", arguments: { repo: REPO, pr: 18 } } });
    const res = drafted!.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent: { id: string; amount: string } };
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.amount).toBe("$530.00");
    expect(res.content[0]!.text).toMatch(/Not covered by the agreed issues/);
    const refused = await handleMcp(FL, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "send_invoice", arguments: { invoice_id: res.structuredContent.id, confirm: false } } });
    expect((refused!.result as { isError: boolean }).isError).toBe(true);
    const bad = await handleMcp(FL, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "draft_invoice", arguments: { repo: REPO, pr: 18, amount: "9999" } } });
    expect((bad!.result as { isError: boolean; content: Array<{ text: string }> }).content[0]!.text).toMatch(/Invalid arguments/);
  });
});

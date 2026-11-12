/**
 * The proof graph: every record behind an envelope, as nodes and the relations between them.
 *
 * Nothing here is computed for show. Each node is a row or a signed object that already exists
 * (a block, a signed request, a promise note, an acceptance, a receipt, a ledger entry, a card), and
 * each carries what a browser needs to check it without trusting this server: the signed bytes and
 * the key they should verify under. PayPal's side cannot be checked by a signature; those nodes say
 * so and point at the endpoint that asks PayPal.
 *
 * `proof(rootId)` is the whole envelope. `proof(rootId, spendId)` is one payment's path back to the
 * owner and nothing else, which is what a payee can be shown.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, blocks, cards, ledger, roots, spends, transfers, type Spend } from "../db/schema";
import * as E from "../envelope/core";
import { getPayPal, paypalMode } from "../paypal/client";
import { getAuthorization } from "../paypal/payments";
import { PROMISE_NOTE_VERSION, RECEIPT_VERSION, gatewayKey, maskEmail } from "./service";
import { TRANSFER_RECEIPT_VERSION } from "./bank";

export type Check =
  /** The owner's signature on the root and every narrowing step down to this block. */
  | { kind: "chain"; label: string; chain: E.Envelope; at: string }
  /** A request signed by the key that holds an envelope, checked against the whole chain. */
  | { kind: "request"; label: string; version: string; signed: { request: unknown; sig: string; chain: E.Envelope }; at: string }
  /** One signature over one object. */
  | { kind: "detached"; label: string; key: string; domain: string; body: unknown; sig: string }
  /** An account opening: signed by the agent's key and its owner's key. */
  | { kind: "account"; label: string; signed: E.SignedAccount }
  /** PayPal's own record, fetched by the gateway when asked. Not a signature. */
  | { kind: "paypal"; label: string; spend: string }
  /** The gateway's record. Shown for completeness; it cannot be checked independently. */
  | { kind: "record"; label: string };

export type Tone = "ink" | "blue" | "green" | "red" | "amber" | "grey";
export type ProofNode = {
  id: string; row: number;
  kind: "owner" | "hold" | "envelope" | "refused" | "request" | "commitment" | "acceptance" | "capture" | "payout" | "credit" | "receipt" | "account" | "transfer" | "card" | "charge";
  title: string; subtitle: string; tone: Tone; state: string | null;
  amountMinor: number | null; at: string | null;
  signer: { label: string; key: string } | null;
  facts: Array<[string, string]>;
  checks: Check[];
  /** Nodes of one payment share a column. */
  column: string | null;
  href: string | null;
};
export type ProofEdge = { from: string; to: string; label: string };
export type ProofRow = { row: number; label: string; hint: string };

const usd = (n: number) => E.money(n);
type Fact = [string, string];
const when = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const list = (x: string[] | null | undefined, none: string) => (x && x.length ? x.join(", ") : none);

export async function proof(rootId: string, onlySpend?: string) {
  const db = getDb();
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) return null;
  const [bs, allSpends, gw] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.rootId, rootId)).orderBy(asc(blocks.depth), asc(blocks.firstSeenAt)),
    db.select().from(spends).where(eq(spends.rootId, rootId)).orderBy(desc(spends.createdAt)).limit(400).then((r) => r.reverse()),
    gatewayKey(),
  ]);
  const focus = onlySpend ? allSpends.find((s) => s.id === onlySpend) : undefined;
  if (onlySpend && !focus) return null;
  const byId = new Map(bs.map((b) => [b.id, b]));
  const chainOf = (id: string): E.Envelope => {
    const out: E.Envelope = [];
    for (let b = byId.get(id); b; b = b.parentId ? byId.get(b.parentId) : undefined) out.unshift(b.raw);
    return out;
  };
  const shownBlocks = focus ? bs.filter((b) => focus.chainIds.includes(b.id)) : bs;
  const live = (focus ? [focus] : allSpends.filter((s) => s.status !== "DENIED")).slice(-12);
  const denied = focus ? [] : allSpends.filter((s) => s.status === "DENIED");

  // PayPal's present word on the hold. One GET; if PayPal can't be reached the node says so.
  const hold = root.authorizationId ? await getAuthorization(getPayPal(), root.authorizationId).catch(() => null) : null;

  const nodes: ProofNode[] = [];
  const edges: ProofEdge[] = [];
  const node = (n: Partial<ProofNode> & Pick<ProofNode, "id" | "row" | "kind" | "title">) =>
    nodes.push({ subtitle: "", tone: "ink", state: null, amountMinor: null, at: null, signer: null, facts: [], checks: [], column: null, href: null, ...n });

  // ---- row 0: the person, and the money PayPal is holding for them
  const rootBlock = bs.find((b) => b.id === rootId)!;
  const caps = rootBlock.caps;
  node({
    id: "owner", row: 0, kind: "owner", title: root.principalName, subtitle: `sealed “${root.title}”`, tone: "ink", at: when(rootBlock.raw.body.issuedAt),
    signer: { label: root.principalName, key: root.principal },
    facts: [
      ["What they allowed", `up to ${usd(caps.limit)} in total, ${usd(caps.perPayment)} a payment`],
      ["Only to", list(caps.payees, "any payee")],
      ["Only for", list(caps.purposes, "any purpose")],
      ["Until", caps.notAfter],
      ...(caps.approveOver !== undefined ? [["Their own signature needed above", usd(caps.approveOver)] as [string, string]] : []),
      ["Signed with", "a key kept in their browser; the gateway never has it"],
    ],
    checks: [{ kind: "chain", label: "The owner's signature on the root envelope", chain: [rootBlock.raw], at: rootBlock.raw.body.issuedAt }],
  });
  node({
    id: "hold", row: 0, kind: "hold", title: "PayPal hold", subtitle: root.authorizationId ?? "none", tone: "blue", amountMinor: root.limitMinor,
    state: hold?.status ?? (root.status === "CLOSED" ? "CLOSED" : null), at: when(root.createdAt),
    facts: [
      ["Authorization", root.authorizationId ?? "none"],
      ["Order", root.paypalOrderId ?? "none"],
      ["PayPal says now", hold ? hold.status : "could not be reached just now"],
      ["Captured from it so far", usd(root.capturedMinor)],
      ...(root.refundedMinor > 0 ? [["Captured and refunded to the owner", `${usd(root.refundedMinor)} (PayPal does not return this to the hold)`] as [string, string]] : []),
      ...(root.releasedMinor !== null ? [["Released back when closed", usd(root.releasedMinor)] as [string, string]] : []),
      ["Environment", paypalMode() === "sandbox" ? "PayPal sandbox (real API, test money)" : "built-in simulator (no PayPal call is made)"],
      ["What it is", "an authorization: a hold on the owner's funding source. It is not escrow, and the owner can release it."],
    ],
    checks: [{ kind: "record", label: "PayPal's record of the hold, read by the gateway when this page loaded. Each payment below can be checked against PayPal separately." }],
  });

  // ---- rows 1..: envelopes, one row per level of delegation
  const maxDepth = Math.max(...shownBlocks.map((b) => b.depth));
  for (const b of shownBlocks) {
    const id = `env:${b.id}`;
    const expired = Date.parse(b.caps.notAfter) < Date.now();
    const left = b.caps.limit - b.spentMinor - b.reservedMinor;
    node({
      id, row: 1 + b.depth, kind: "envelope", title: b.holderLabel, subtitle: `envelope for up to ${usd(b.caps.limit)}`, amountMinor: b.caps.limit, at: when(b.raw.body.issuedAt),
      // Closing the envelope ends the root; only an envelope that was cut off on its own is "revoked".
      tone: b.revokedAt && b.id !== rootId ? "red" : root.status === "CLOSED" ? "grey" : "ink", state: b.revokedAt && b.id !== rootId ? "REVOKED" : root.status === "CLOSED" ? "CLOSED" : expired ? "EXPIRED" : "LIVE",
      signer: b.parentId ? { label: byId.get(b.parentId)?.holderLabel ?? "its parent", key: b.raw.body.issuer } : { label: root.principalName, key: root.principal },
      facts: [
        ["Held by", `${b.holderLabel} (${E.accountNumber(b.holder)})`],
        ["Given by", b.parentId ? `${byId.get(b.parentId)?.holderLabel}, who could only narrow its own envelope` : `${root.principalName}, the owner`],
        ["Limit", `${usd(b.caps.limit)} in total, ${usd(b.caps.perPayment)} a payment`],
        ["Only to", list(b.caps.payees, "any payee")],
        ["Only for", list(b.caps.purposes, "any purpose")],
        ["Spent / set aside / left", `${usd(b.spentMinor)} / ${usd(b.reservedMinor)} / ${usd(Math.max(0, left))}`],
        ["May split again", b.caps.splits > 0 ? `${b.caps.splits} more time(s)` : "no"],
        ["Expires", b.caps.notAfter],
        ...(b.revokedAt ? [["Revoked", when(b.revokedAt)!] as [string, string]] : []),
      ],
      checks: [{ kind: "chain", label: b.parentId ? "Every signature from the owner down to this envelope, and that each step only narrowed" : "The owner's signature on this envelope", chain: chainOf(b.id), at: b.raw.body.issuedAt }],
      href: `/a/${b.holder}`,
    });
    if (b.parentId && byId.has(b.parentId) && shownBlocks.some((x) => x.id === b.parentId)) edges.push({ from: `env:${b.parentId}`, to: id, label: `split off ${usd(b.caps.limit)}` });
    else { edges.push({ from: "owner", to: id, label: "sealed" }); edges.push({ from: "hold", to: id, label: "backs it" }); }
  }

  // ---- refused requests, grouped by the envelope that made them
  const base = 2 + maxDepth;
  const byLeaf = new Map<string, Spend[]>();
  for (const s of denied) byLeaf.set(s.leafId, [...(byLeaf.get(s.leafId) ?? []), s]);
  for (const [leaf, rows] of byLeaf) {
    if (!byId.has(leaf)) continue;
    const codes = [...new Set(rows.flatMap((r) => r.reasons.map((x) => x.code)))];
    node({
      id: `refused:${leaf}`, row: base, kind: "refused", title: `${rows.length} refused`, subtitle: `asked by ${rows[0]!.leafLabel}`, tone: "red", state: "DENIED", at: when(rows[rows.length - 1]!.createdAt),
      amountMinor: rows.reduce((n, r) => n + r.amountMinor, 0), column: `refused:${leaf}`,
      facts: [["Why", codes.join(", ")], ...rows.slice(-5).map((r) => [`${usd(r.amountMinor)} to ${r.payee.includes("@") ? r.payee : r.payee}`, r.reasons.map((x) => x.detail).join("; ").slice(0, 160)] as [string, string]), ["Money moved", "none: a refused request never reaches PayPal"]],
      checks: [{ kind: "record", label: "The gateway's record of requests it refused. The rules it applied are in the protocol; anyone can re-run them on a signed request." }],
    });
    edges.push({ from: `env:${leaf}`, to: `refused:${leaf}`, label: "asked, refused" });
  }

  // ---- one column per payment: request or commitment, acceptance, capture, payout or credit, receipt
  const heldAgents = new Map<string, string>(); // agent key -> the credit node that paid it
  for (const s of live) {
    const col = s.id;
    const promise = Boolean(s.promiseExpiresAt);
    const payeeName = s.payeeAgent ? (await db.query.accounts.findFirst({ where: eq(accounts.agent, s.payeeAgent) }))?.label ?? s.payee : s.payee;
    const reqId = `req:${s.id}`;
    const at = s.signed.request.at;
    const approval = Boolean(s.signed.request && "releaseBy" in s.signed.request && s.signed.request.releaseBy === root.principal);
    node({
      id: reqId, row: base, kind: promise ? "commitment" : "request", column: col, amountMinor: s.amountMinor, at,
      title: promise ? `${usd(s.amountMinor)} set aside` : `${usd(s.amountMinor)} payment`, subtitle: `for ${payeeName}`,
      tone: s.status === "LAPSED" || s.status === "FAILED" ? "grey" : s.status === "REFUND_DUE" ? "red" : "ink", state: s.status,
      signer: { label: s.leafLabel, key: s.signed.chain[s.signed.chain.length - 1]!.body.holder },
      facts: ([
        ["Asked by", s.leafLabel],
        ["Payee", s.payeeAgent ? `${payeeName}, account ${s.payee}` : s.payee],
        ["Purpose", s.purpose + (s.memo ? ` · ${s.memo}` : "")],
        ...(s.agentNote ? [["The agent's stated reason", `“${s.agentNote}” (stored for the owner; the gateway never reads it)`] as [string, string]] : []),
        ...(promise ? [["What a set-aside is", "money reserved at every level so nothing else can spend it. It is not a payment and not escrow: the owner can still revoke."] as [string, string], ["Held until", when(s.promiseExpiresAt)!]] : []),
        ...(promise && s.promiseNote?.releaseBy ? [["Can only be released by", approval ? `${root.principalName}, the owner (over the approval threshold)` : `the key ${E.fingerprint(s.promiseNote.releaseBy)}`] as [string, string]] : []),
        ["Budget it used", s.chainIds.map((id) => byId.get(id)?.holderLabel ?? id).join(" → ")],
      ] as Fact[]),
      checks: [
        { kind: "request", label: "Signed by the key this envelope was given to, and inside every limit up the chain", version: s.signed.request.v, signed: s.signed, at },
        ...(s.promiseNote ? [{ kind: "detached" as const, label: "The gateway's signed note to the payee that the money is set aside", key: s.promiseNote.gateway, domain: PROMISE_NOTE_VERSION, body: (({ sig: _s, ...b }) => b)(s.promiseNote), sig: s.promiseNote.sig }] : []),
      ],
    });
    edges.push({ from: `env:${s.leafId}`, to: reqId, label: promise ? "set aside" : "asked to pay" });
    let last = reqId;

    if (s.delivery) {
      const id = `acc:${s.id}`;
      const d = s.delivery as typeof s.delivery & { request?: unknown };
      const who = d.by === root.principal ? root.principalName : bs.find((b) => b.holder === d.by)?.holderLabel ?? (d.by === s.payeeAgent ? payeeName : E.fingerprint(d.by));
      node({
        id, row: base + 1, kind: "acceptance", column: col, at: d.at, tone: "green", state: d.by === root.principal ? "OWNER SIGNED" : "ACCEPTED",
        title: d.by === root.principal ? "Owner approved" : "Work accepted", subtitle: `signed by ${who}`, signer: { label: who, key: d.by },
        facts: ([
          ["Signed by", `${who} (${E.fingerprint(d.by)})`],
          ...(d.work ? [["Fingerprint of what was delivered", d.work] as [string, string], ["What that proves", "which file or message was accepted, not that it is good. The signer is vouching; the gateway does not judge work."]] : []),
          ...(d.note ? [["Note", d.note] as [string, string]] : []),
          ["Effect", "this signature, and nothing else, released the money that was set aside"],
        ] as Fact[]),
        checks: [d.request
          ? { kind: "detached", label: "The acceptor's own signature", key: d.by, domain: E.ACCEPT_VERSION, body: d.request, sig: d.sig }
          : { kind: "record", label: "Recorded by the gateway and named on the signed receipt below" }],
      });
      edges.push({ from: last, to: id, label: "released by" });
      last = id;
    }

    if (s.captureId) {
      const id = `cap:${s.id}`;
      const pending = s.payoutStatus === "AWAITING_CAPTURE";
      node({
        id, row: base + 2, kind: "capture", column: col, amountMinor: s.amountMinor, tone: pending ? "amber" : s.status === "FAILED" ? "grey" : s.status === "REFUND_DUE" ? "red" : "blue",
        state: pending ? "PENDING AT PAYPAL" : s.refundId ? "REFUNDED" : s.status === "REFUND_DUE" ? "REFUND DUE" : "CAPTURED",
        title: "PayPal capture", subtitle: s.captureId,
        facts: [["Capture id", s.captureId], ["Taken from", `the hold ${root.authorizationId}`], ["Amount", usd(s.amountMinor)], ...(s.refundId ? [["Refund", s.refundId] as [string, string]] : []), ["What it is", "a partial capture: PayPal moves this much of the held money, and refuses to capture past the hold"]],
        checks: [s.receipt ? { kind: "paypal", label: "Ask PayPal for this capture and compare", spend: s.id } : { kind: "record", label: "PayPal's capture id as the gateway recorded it" }],
      });
      edges.push({ from: last, to: id, label: "captured" });
      last = id;
    }

    if (s.payoutStatus === "HELD_IN_ACCOUNT" && s.payeeAgent) {
      const id = `out:${s.id}`;
      const entry = await db.query.ledger.findFirst({ where: and(eq(ledger.agent, s.payeeAgent), eq(ledger.kind, "income"), eq(ledger.ref, s.id)) });
      node({
        id, row: base + 3, kind: "credit", column: col, amountMinor: s.amountMinor, tone: "green", state: "IN ITS BALANCE", at: when(entry?.createdAt),
        title: `Credited to ${payeeName}`, subtitle: "kept in its account; no payout",
        facts: [["Ledger entry", entry ? `#${entry.id}` : "missing"], ["Account", s.payee], ["Balance after", entry ? usd(entry.balanceAfterMinor) : "unknown"], ["Rule", "one ledger row per payment, so it cannot be credited twice"]],
        checks: [{ kind: "record", label: "The gateway's ledger entry; it is named on the signed receipt" }],
      });
      edges.push({ from: last, to: id, label: "credited" });
      last = id;
      if (!focus) heldAgents.set(s.payeeAgent, id);
    } else if (s.payoutBatchId) {
      const id = `out:${s.id}`;
      const st = s.payoutStatus ?? "PENDING";
      node({
        id, row: base + 3, kind: "payout", column: col, amountMinor: s.amountMinor, state: st,
        tone: st === "SUCCESS" ? "green" : st === "UNCLAIMED" || st === "PENDING" ? "amber" : "red",
        title: "PayPal payout", subtitle: s.payoutBatchId,
        facts: [
          ["Batch", s.payoutBatchId], ...(s.payoutItemId ? [["Item", s.payoutItemId] as [string, string]] : []), ["Sent to", maskEmail(s.payoutTo ?? s.payee)],
          ["PayPal's status", st],
          ["What that means", st === "SUCCESS" ? "delivered to the payee's PayPal account" : st === "UNCLAIMED" ? "accepted by PayPal and held for the payee to claim: no PayPal account at that address yet. Not delivered." : st === "PENDING" ? "accepted by PayPal, not yet processed. Not delivered yet." : "PayPal did not deliver it"],
        ],
        checks: [s.receipt ? { kind: "paypal", label: "Ask PayPal where this payout is", spend: s.id } : { kind: "record", label: "PayPal's batch id as the gateway recorded it" }],
      });
      edges.push({ from: last, to: id, label: "paid out" });
      last = id;
    }

    if (s.receipt) {
      const id = `rec:${s.id}`;
      const { sig, ...body } = s.receipt;
      node({
        id, row: base + 4, kind: "receipt", column: col, amountMinor: s.amountMinor, tone: "ink", state: "SIGNED", at: s.receipt.issuedAt, title: "Receipt", subtitle: "signed by the gateway",
        signer: { label: "the gateway", key: s.receipt.gateway },
        facts: [["Binds together", "the signed request, every envelope above it, the owner's key, and PayPal's capture and payout ids"], ["Issued", s.receipt.issuedAt], ["Anyone can check it", "with the gateway's public key, without asking this site"]],
        checks: [{ kind: "detached", label: "The gateway's signature over the whole receipt", key: s.receipt.gateway, domain: RECEIPT_VERSION, body, sig }],
        href: `/r/${s.id}`,
      });
      edges.push({ from: last, to: id, label: "receipt" });
    }
  }

  // ---- what an agent that was paid here did next with its balance
  for (const [agent, from] of heldAgents) {
    const acct = await db.query.accounts.findFirst({ where: eq(accounts.agent, agent) });
    if (!acct) continue;
    const aid = `acct:${agent}`;
    node({
      id: aid, row: base + 5, kind: "account", title: `${acct.label}'s account`, subtitle: `balance ${usd(acct.balanceMinor)}`, amountMinor: acct.balanceMinor, tone: acct.frozenAt ? "red" : "blue", state: acct.frozenAt ? "FROZEN" : "OPEN", at: when(acct.openedAt),
      signer: { label: `${acct.label} and ${acct.ownerName}`, key: acct.agent },
      facts: [
        ["Account", `acct:${acct.account.toLowerCase()}`], ["Answers for it", acct.ownerName],
        ["Most it may pay at once", acct.perPaymentMinor === null ? "no cap" : usd(acct.perPaymentMinor)], ["Most it may spend in a day", acct.perDayMinor === null ? "no cap" : usd(acct.perDayMinor)],
        ["Note", "money in a balance is fungible: what this agent paid next is shown, not which dollars it used"],
      ],
      // The signed opening names the owner's PayPal address, so it is not published here; the agent's own page shows what it signed for.
      checks: [{ kind: "record", label: "Opened with two signatures, the agent's own key and its owner's; the gateway checked both when it was opened" }],
      href: `/a/${agent}`,
    });
    edges.push({ from, to: aid, label: "into its balance" });
    const [outs, held] = await Promise.all([
      db.select().from(transfers).where(and(eq(transfers.fromAgent, agent), inArray(transfers.status, ["BOOKED", "PAID", "PAYOUT_PENDING", "UNCLAIMED"]))).orderBy(desc(transfers.createdAt)).limit(5),
      db.select().from(cards).where(eq(cards.holder, agent)).orderBy(desc(cards.createdAt)).limit(2),
    ]);
    const cardNode = new Map<string, string>();
    for (const c of held) {
      const merchant = await db.query.accounts.findFirst({ where: eq(accounts.agent, c.merchantAgent) });
      const id = `card:${c.id}`;
      cardNode.set(c.id, id);
      const state = c.cancelledAt ? "CANCELLED" : c.charges >= c.maxCharges ? "ENDED ITSELF" : c.notAfter.getTime() < Date.now() ? "EXPIRED" : "ACTIVE";
      node({
        id, row: base + 6, kind: "card", title: `Card for ${merchant?.label ?? "a merchant"}`, subtitle: c.number, tone: state === "ACTIVE" ? "blue" : "grey", state, amountMinor: c.perChargeMinor, at: when(c.createdAt),
        signer: { label: acct.label, key: c.holder },
        facts: [["Locked to", `${merchant?.label ?? "merchant"} (only its key can charge it)`], ["Per charge", usd(c.perChargeMinor)], ["Charges", `${c.charges} of ${c.maxCharges} used`], ["Valid until", c.notAfter.toISOString()]],
        checks: [{ kind: "detached", label: "The agent's signature on the card's terms", key: c.holder, domain: E.CARD_VERSION, body: c.signed.body, sig: c.signed.sig }],
      });
      edges.push({ from: aid, to: id, label: "issued" });
    }
    for (const t of outs.reverse()) {
      const id = `tr:${t.id}`;
      const st = t.status === "BOOKED" ? "MOVED ON THE LEDGER" : t.payoutStatus ?? t.status;
      const toLabel = t.toAgent ? (await db.query.accounts.findFirst({ where: eq(accounts.agent, t.toAgent) }))?.label ?? t.payee : t.kind === "withdraw" ? `${acct.ownerName} (its owner)` : maskEmail(t.payoutTo ?? t.payee);
      node({
        id, row: base + 7, kind: t.kind === "charge" ? "charge" : "transfer", title: `${usd(t.amountMinor)} ${t.kind === "charge" ? "charged by" : t.kind === "withdraw" ? "withdrawn to" : "to"} ${toLabel}`,
        subtitle: t.payoutBatchId ? `PayPal payout ${t.payoutBatchId}` : "no PayPal call", amountMinor: t.amountMinor, at: when(t.createdAt), state: st,
        tone: t.status === "BOOKED" || t.payoutStatus === "SUCCESS" ? "green" : "amber",
        signer: t.kind === "charge" ? { label: toLabel, key: (t.signed.request as E.ChargeRequest).merchant } : { label: acct.label, key: agent },
        facts: [
          ["Signed by", t.kind === "charge" ? `${toLabel}, the merchant the card is locked to` : `${acct.label}'s own key`],
          ["Went", t.toAgent && !t.payoutTo ? "to another account here, at once" : `out through PayPal to ${maskEmail(t.payoutTo ?? "")}`],
          ...(t.payoutBatchId ? [["PayPal's status", t.payoutStatus ?? "PENDING"] as [string, string]] : []),
          ...(t.memo ? [["For", t.memo] as [string, string]] : []),
        ],
        checks: t.receipt ? [{ kind: "detached", label: "The gateway's signed receipt for this movement", key: t.receipt.gateway, domain: TRANSFER_RECEIPT_VERSION, body: (({ sig: _s, ...b }) => b)(t.receipt), sig: t.receipt.sig }] : [{ kind: "record", label: "The gateway's record" }],
      });
      edges.push({ from: t.cardId && cardNode.has(t.cardId) ? cardNode.get(t.cardId)! : aid, to: id, label: t.kind === "charge" ? "charged" : t.kind === "withdraw" ? "withdrew" : "paid" });
    }
  }

  const rowLabels: ProofRow[] = [
    { row: 0, label: "A person, and PayPal", hint: "one signature and one hold stand behind everything below" },
    ...Array.from({ length: maxDepth + 1 }, (_, i) => ({ row: 1 + i, label: i === 0 ? "Authority" : `Delegated, level ${i}`, hint: i === 0 ? "the envelope the owner sealed" : "split off by the agent above; it could only be narrower" })),
    { row: base, label: "Asked", hint: "signed by the agent that holds the envelope" },
    { row: base + 1, label: "Released", hint: "a named key signed that the work was accepted, or the owner approved" },
    { row: base + 2, label: "PayPal captured", hint: "money actually taken from the hold" },
    { row: base + 3, label: "Reached the payee", hint: "a PayPal payout, or a credit to the payee agent's balance" },
    { row: base + 4, label: "Receipt", hint: "signed by the gateway; binds all of the above" },
    { row: base + 5, label: "The payee's account", hint: "an agent that was paid and kept the money" },
    { row: base + 6, label: "Its cards", hint: "permissions it signed for one merchant each" },
    { row: base + 7, label: "What it paid next", hint: "out of its balance, on its own signature or a merchant's" },
  ].filter((r) => nodes.some((n) => n.row === r.row));

  return {
    root: { id: root.id, title: root.title, owner: root.principalName, ownerKey: root.principal, status: root.status, limitMinor: root.limitMinor, capturedMinor: root.capturedMinor, releasedMinor: root.releasedMinor, authorizationId: root.authorizationId },
    focus: focus ? { spend: focus.id, amountMinor: focus.amountMinor, payee: focus.payeeAgent ? focus.payee : maskEmail(focus.payee) } : null,
    mode: paypalMode(), gateway: gw.publicKey, at: new Date().toISOString(),
    rows: rowLabels, nodes, edges,
  };
}

// @ts-check
/**
 * A researcher agent hires a writer agent, with money it was given and cannot exceed.
 *
 * This program uses only the published surface of @envelope/sdk and plain HTTP to an Envelope
 * gateway. It holds no PayPal credentials and there is nowhere in it to put any: the gateway is the
 * only thing that talks to PayPal.
 *
 *   GATEWAY=http://localhost:3000 node index.mjs
 *   GATEWAY=http://localhost:3000 node index.mjs --agent researcher.json --envelope envelope.json
 *
 * Without --agent/--envelope it plays the owner too and seals a small demo envelope, so it runs on
 * its own. With them, it adopts an envelope a person sealed elsewhere (in the browser console, or
 * with `npx tsx scripts/agent.ts seal`): --agent is the file `agent.export()` wrote, --envelope the chain.
 */
import { readFileSync } from "node:fs";
import { Agent, EnvelopeError, Gateway, Owner, fingerprint, formatMinor } from "@envelope/sdk";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1] ?? ""]] : pairs), /** @type {[string, string][]} */ ([])));
const gateway = new Gateway(process.env.GATEWAY ?? "http://localhost:3000");
const say = (/** @type {string} */ who, /** @type {string} */ what) => console.log(`${who.padEnd(11)} ${what}`);
const settlement = (/** @type {import("@envelope/sdk").Payment} */ p) =>
  p.heldInBalance ? "credited to the payee agent's balance (no payout needed)" : p.delivered ? "delivered by PayPal" : `NOT delivered yet: PayPal says ${p.status}`;

// ── The writer: an agent with an account of its own, so it can be paid and keep what it earns. ──
// It takes two signatures to open: the agent's, and that of the person who answers for it.
const bea = await Owner.generate({ gateway, label: "Bea" });
const writer = await Agent.generate({ gateway, label: "writer-agent" });
const account = await writer.openAccount({ owner: bea, settleTo: "bea@example.com", hold: true, perPayment: "25.00" });
say("writer", `can be paid as ${account.payee}; Bea answers for it`);

// ── The researcher: holds an envelope a person sealed for it. ──
/** @type {Agent} */ let researcher;
/** @type {Owner | null} */ let ada = null;
if (args.agent && args.envelope) {
  researcher = await Agent.fromJSON(JSON.parse(readFileSync(args.agent, "utf8")), { gateway });
  await researcher.hold(JSON.parse(readFileSync(args.envelope, "utf8"))); // verified locally before it is accepted
  say("researcher", "adopted the envelope from disk");
} else {
  ada = await Owner.generate({ gateway, label: "Ada" });
  researcher = await Agent.generate({ gateway, label: "researcher" });
  const sealed = await ada.seal({ to: researcher.identity, limit: "50.00", perPayment: "25.00", payees: [writer.payee], purposes: ["writing"], hours: 1, splits: 1, title: "Report budget" });
  await researcher.hold(sealed.chain);
  say("Ada", `sealed $50.00 for researcher; PayPal is holding it (authorization ${sealed.root.authorizationId})`);
}
const mine = await researcher.authority();
say("researcher", `may spend ${formatMinor(mine.availableMinor ?? 0)}: only to ${mine.caps.payees?.join(", ") ?? "anyone"}, only for ${mine.caps.purposes?.join(", ") ?? "anything"}, until ${mine.caps.notAfter}`);

// ── Before any work: the writer checks that the researcher is good for the money. ──
const hello = await researcher.introduce({ amount: "20.00", payee: writer.payee, purpose: "writing" });
const standing = await writer.checkIntroduction(hello.token);
say("writer", `checked the researcher: ${standing.good ? "GOOD" : "NOT GOOD"} (behind it: ${standing.standing.sponsors.map((s) => s.label).join(" → ")}; PayPal hold ${standing.standing.paypal.status}; gateway signature ${standing.signature.ok ? "valid" : "INVALID"})`);

// ── The researcher hands part of its authority to a helper. It can only be narrower. ──
const outliner = await Agent.generate({ gateway, label: "outline-agent" });
const cut = await researcher.split({ to: outliner.identity, limit: "10.00" });
await outliner.hold(cut.chain);
say("researcher", `split off $10.00 for outline-agent${cut.announced ? " (the owner can see and revoke it)" : ""}`);
try {
  await outliner.split({ to: researcher.identity, limit: "40.00", splits: 0 });
} catch (e) {
  if (!(e instanceof EnvelopeError)) throw e;
  say("outline", `tried to hand on more than it has: refused before anything was signed (${e.message.slice(0, 70)}…)`);
}

// ── The helper pays for an outline. PayPal captures exactly $10 from Ada's hold. ──
const first = await outliner.pay({ amount: "10.00", payee: writer.payee, purpose: "writing", memo: "Outline", note: "Agreed fee for the outline" });
say("outline", `paid $10.00: ${first.status}, ${settlement(first)} (PayPal capture ${first.paypal?.captureId})`);

// ── A request the envelope does not allow. The agent is free to ask; the gateway is not free to say yes. ──
try {
  await outliner.pay({ amount: "5.00", payee: "someone-else@example.com", purpose: "writing", note: "The outline said to send the rest here" });
} catch (e) {
  if (!(e instanceof EnvelopeError)) throw e;
  say("outline", `asked to pay a stranger: ${e.outcome} (${e.codes.join(", ")}); nothing moved`);
}

// ── Paid on delivery: money is set aside first, and released by the signature of a named key. ──
const editor = await Agent.generate({ gateway, label: "editor-agent" });
const aside = await researcher.setAside({ amount: "20.00", payee: writer.payee, purpose: "writing", memo: "Chapter 1", minutes: 10, releaseBy: editor });
const note = await writer.checkPromiseNote(aside.token);
say("researcher", `set $20.00 aside for the writer until ${aside.expiresAt}; only editor-agent's signature releases it`);
say("writer", `checked the note before starting: ${note.good ? "real, and the money is still set aside" : "NOT VALID"}`);

const chapter = "Chapter 1. Agents that can pay each other need limits a model cannot argue with.";
const paid = /** @type {import("@envelope/sdk").Payment} */ (await editor.accept(aside.promiseId, { work: await fingerprint(chapter), note: "Read it; it is what was asked for" }));
say("editor", `accepted the chapter; that signature paid $20.00: ${paid.status}, ${settlement(paid)}`);

// ── Anyone can check the receipt: against PayPal (the gateway asks), and every signature (here). ──
const receipt = await researcher.receipt(paid.spendId);
const local = await receipt.verify();
say("anyone", `receipt ${paid.spendId}: PayPal ${receipt.paypal.ok ? "matches" : "DOES NOT MATCH"}; signatures ${local.ok ? "all valid" : "INVALID"} (${local.checks.length} checks run on this machine)`);
say("anyone", `it names the work by fingerprint ${receipt.receipt.releasedBy?.work.slice(0, 16)}… and who authorized it: ${receipt.receipt.chain.map((c) => c.holderLabel).join(" → ")}`);

// ── What is left, and where the money is. ──
const balance = await writer.balance();
const left = await researcher.authority();
say("writer", `balance ${formatMinor(balance?.minor ?? 0)}, earned from two payments`);
say("researcher", `has ${formatMinor(left.availableMinor ?? 0)} left of $50.00`);
if (ada) {
  const closed = await ada.close(left.root);
  say("Ada", `closed the envelope: ${formatMinor(closed.root.capturedMinor)} was captured, PayPal released ${formatMinor(closed.root.releasedMinor ?? 0)}`);
}
console.log(`\nProof graph: ${gateway.proofUrl(left.root)}`);

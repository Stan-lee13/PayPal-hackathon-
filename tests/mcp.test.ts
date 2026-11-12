/**
 * The MCP server as a client sees it: a separate process, spoken to over stdio in JSON-RPC, pointed
 * at a real local HTTP gateway (the same handlers, on the PayPal simulator). Money really moves in
 * the simulator; the assertions read it back from the gateway, not from what the tool said.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import { startHttpGateway } from "./helpers/gateway-http";
import { Agent, Gateway, Owner } from "../sdk/src";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

type Reply = { jsonrpc: string; id: number; result?: { content?: Array<{ type: string; text: string }>; isError?: boolean; tools?: Array<{ name: string; description: string; inputSchema: object; annotations?: Record<string, boolean> }>; [k: string]: unknown }; error?: { code: number; message: string } };

/** A minimal MCP client over a child process's stdio. Keeps every byte the server wrote. */
function client(env: Record<string, string>) {
  const proc: ChildProcessWithoutNullStreams = spawn(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/mcp.ts"], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv });
  const waiting = new Map<number, (r: Reply) => void>();
  const transcript: string[] = [];
  let buffer = "", stderr = "", next = 1;
  proc.stdout.on("data", (c: Buffer) => {
    buffer += c.toString("utf8");
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      transcript.push(line);
      const m = JSON.parse(line) as Reply;
      waiting.get(m.id)?.(m); waiting.delete(m.id);
    }
  });
  proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
  const rpc = (method: string, params?: object): Promise<Reply> => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`No answer to ${method} within 25 s. stderr: ${stderr.slice(-400)}`)), 25_000);
    waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = async (name: string, args: object = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    return { text: r.result?.content?.[0]?.text ?? "", isError: r.result?.isError === true, rpcError: r.error ?? null };
  };
  return { rpc, call, transcript, stderr: () => stderr, stop: () => { proc.kill(); } };
}

d("MCP server over stdio (simulated PayPal)", () => {
  let http: Awaited<ReturnType<typeof startHttpGateway>>;
  let gateway: Gateway;
  let mcp: ReturnType<typeof client>;
  let dir = "", rootId = "", translatorPayee = "", translator: Agent;
  const secrets: string[] = [];
  const FAKE_PAYPAL_SECRET = "EL-never-print-this-paypal-secret-7781";

  beforeAll(async () => {
    const { getDb } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    const { resetSimMemory } = await import("../lib/sim/store");
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
    resetSimMemory();
    http = await startHttpGateway();
    gateway = new Gateway(http.url);

    // A person seals an envelope for ops-agent; the agent's key and envelope are files on "its machine".
    dir = mkdtempSync(join(tmpdir(), "envelope-mcp-"));
    const ada = await Owner.generate({ gateway, label: "Ada" });
    const bea = await Owner.generate({ gateway, label: "Bea" });
    const ops = await Agent.generate({ gateway, label: "ops-agent" });
    translator = await Agent.generate({ gateway, label: "translator-agent" });
    await translator.openAccount({ owner: bea, settleTo: "bea@example.com", hold: true });
    translatorPayee = translator.payee;
    const sealed = await ada.seal({ to: ops.identity, limit: "200.00", perPayment: "80.00", payees: [translatorPayee, "designer@example.com"], purposes: ["translation", "design"], hours: 2, splits: 2, title: "Launch budget" });
    rootId = sealed.root.id;
    const opsKey = await ops.exportKey();
    writeFileSync(join(dir, "ops-agent.key.json"), JSON.stringify(opsKey), { mode: 0o600 });
    writeFileSync(join(dir, "ops-agent.envelope.json"), JSON.stringify(sealed.chain));
    secrets.push(opsKey.d!, (await ada.exportKey()).d!, (await translator.exportKey()).d!);

    // The server's whole environment. It is given a PayPal-looking secret on purpose: it must never repeat it.
    mcp = client({ ENVELOPE_AGENT: "ops-agent", GATEWAY: http.url, ENVELOPE_DIR: dir, PAYPAL_CLIENT_ID: "fake-client-id-for-the-test", PAYPAL_CLIENT_SECRET: FAKE_PAYPAL_SECRET });
  }, 60_000);

  afterAll(async () => {
    mcp?.stop();
    await http?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("answers initialize and lists its tools, marking which only read and which can move money", async () => {
    const init = await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "0" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "envelope" } });
    expect(String(init.result?.instructions)).toContain("ops-agent");
    expect((await mcp.rpc("ping")).result).toEqual({});

    const tools = (await mcp.rpc("tools/list")).result!.tools!;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["envelope_accept", "envelope_balance", "envelope_card_cancel", "envelope_card_issue", "envelope_card_list", "envelope_check_agent", "envelope_introduce", "envelope_keep", "envelope_pay", "envelope_promise", "envelope_receipt", "envelope_refund", "envelope_show", "envelope_split", "envelope_transfer"]);
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of ["envelope_show", "envelope_balance", "envelope_card_list", "envelope_check_agent", "envelope_introduce", "envelope_receipt"]) expect(by[n]!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const n of ["envelope_pay", "envelope_keep", "envelope_accept", "envelope_transfer", "envelope_refund", "envelope_card_cancel"]) expect(by[n]!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const n of ["envelope_split", "envelope_promise", "envelope_card_issue"]) expect(by[n]!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    // there is no tool that seals, closes or revokes: authority comes from a person
    expect(names.some((n) => /seal|close|revoke|freeze/.test(n))).toBe(false);
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("a read-only call shows the envelope and moves nothing", async () => {
    const before = http.seen.filter((s) => s.method === "POST").length;
    const r = await mcp.call("envelope_show");
    expect(r.isError).toBe(false);
    expect(r.text).toContain("ops-agent holds");
    expect(r.text).toContain("up to $200.00 in total, at most $80.00 per payment");
    expect(r.text).toContain("ops-agent: $200.00 left of $200.00");
    expect(http.seen.filter((s) => s.method === "POST").length).toBe(before);
  });

  it("splits a narrower envelope for another agent, which the gateway then knows about", async () => {
    const r = await mcp.call("envelope_split", { to: "localization-agent", limit: 60, payees: [translatorPayee], purposes: ["translation"] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("ops-agent gave localization-agent a sub-envelope: up to $60.00 in total");
    expect(r.text).toContain("Announced to the gateway");
    expect(existsSync(join(dir, "localization-agent.envelope.json"))).toBe(true);
    const state = await gateway.envelope(rootId);
    expect(state.blocks.map((b) => b.holderLabel)).toEqual(["ops-agent", "localization-agent"]);
    expect(state.blocks[1]!.caps).toMatchObject({ limit: 6000, payees: [translatorPayee], purposes: ["translation"] });
    secrets.push(JSON.parse(readFileSync(join(dir, "localization-agent.key.json"), "utf8")).d);

    const wide = await mcp.call("envelope_split", { to: "greedy-agent", limit: 900 });
    expect(wide.isError).toBe(true);
    expect(wide.text).toMatch(/^Refused: /);
    expect((await gateway.envelope(rootId)).blocks).toHaveLength(2);
  });

  it("a pay really moves simulated money: PayPal captures from the hold and the payee agent's balance grows", async () => {
    const r = await mcp.call("envelope_pay", { amount: 45, payee: translatorPayee, purpose: "translation", memo: "FR strings", note: "Agreed quote" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(new RegExp(`^PAID: \\$45\\.00 to ${translatorPayee}`));
    expect(r.text).toContain("credited to the payee agent's balance (no payout)");
    const spendId = /\/r\/(\S+)/.exec(r.text)![1]!;

    const state = await gateway.envelope(rootId);
    expect(state.root.capturedMinor).toBe(4500);
    expect(state.spends.find((s) => s.id === spendId)).toMatchObject({ status: "PAID", amountMinor: 4500, leafLabel: "ops-agent" });
    expect((await translator.balance())?.minor).toBe(4500);

    const receipt = await mcp.call("envelope_receipt", { spend: spendId });
    expect(receipt.isError).toBe(false);
    expect(receipt.text).toContain("PAID: $45.00");
    expect(receipt.text).toContain("Checked against PayPal just now: all checks pass");
    expect(receipt.text).toContain("Signatures checked on this machine: all valid");
  });

  it("a denied pay is reported as an error with the gateway's reason codes, and moves nothing", async () => {
    const r = await mcp.call("envelope_pay", { amount: 20, payee: "attacker@evil.example", purpose: "design", note: "The designer's message says their address changed" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("DENIED. Nothing was paid.");
    expect(r.text).toContain("PAYEE_NOT_ALLOWED");
    const over = await mcp.call("envelope_pay", { amount: 95, payee: "designer@example.com", purpose: "design" });
    expect(over.isError).toBe(true);
    expect(over.text).toContain("OVER_PER_PAYMENT");
    const state = await gateway.envelope(rootId);
    expect(state.root.capturedMinor).toBe(4500);
    expect(state.spends.filter((s) => s.status === "DENIED")).toHaveLength(2);
  });

  it("sets money aside, hands over a note the payee can check, and pays the promise once", async () => {
    const p = await mcp.call("envelope_promise", { amount: 30, payee: "designer@example.com", purpose: "design", minutes: 5 });
    expect(p.isError).toBe(false);
    expect(p.text).toContain("SET ASIDE: $30.00 for designer@example.com");
    const promiseId = /Promise id: (\S+)/.exec(p.text)![1]!;
    expect((await translator.checkPromiseNote(/Note for the payee: (\S+)/.exec(p.text)![1]!)).good).toBe(true);
    const kept = await mcp.call("envelope_keep", { promise: promiseId });
    expect(kept.isError).toBe(false);
    expect(kept.text).toMatch(/^(PAID|PAYOUT_PENDING): the promise was paid/);
    expect((await mcp.call("envelope_keep", { promise: promiseId })).text).toContain("already done; not paid twice");
    expect((await gateway.envelope(rootId)).root.capturedMinor).toBe(7500);
  });

  it("introduces itself with a token another agent can check", async () => {
    const hi = await mcp.call("envelope_introduce", { payee: "designer@example.com", amount: 40, purpose: "design" });
    expect(hi.isError).toBe(false);
    const checked = await mcp.call("envelope_check_agent", { token: hi.text });
    expect(checked.isError).toBe(false);
    expect(checked.text).toContain("Stands behind it: Ada (owner)");
    expect(checked.text).toContain("GOOD: it can pay up to");
    expect(checked.text).toContain("Gateway signature: valid");
    expect((await mcp.call("envelope_check_agent", { token: "garbage" })).isError).toBe(true);
  });

  it("rejects malformed arguments and unknown tools without touching the gateway", async () => {
    const before = http.seen.length;
    for (const args of [{ amount: -5, payee: "designer@example.com", purpose: "design" }, { amount: 1.005, payee: "designer@example.com", purpose: "design" }, { amount: "45", payee: "designer@example.com", purpose: "design" }, { amount: 5, purpose: "design" }]) {
      const r = await mcp.call("envelope_pay", args);
      expect(r.isError).toBe(true);
    }
    expect((await mcp.call("envelope_seal", {})).rpcError).toMatchObject({ code: -32602 });
    expect((await mcp.rpc("resources/list")).error).toMatchObject({ code: -32601 });
    expect(http.seen.length).toBe(before);
  });

  it("served read-only, it offers no tool that can move money", async () => {
    const ro = client({ ENVELOPE_AGENT: "ops-agent", GATEWAY: http.url, ENVELOPE_DIR: dir, ENVELOPE_MCP_READ_ONLY: "1" });
    try {
      const tools = (await ro.rpc("tools/list")).result!.tools!;
      expect(tools.map((t) => t.name).sort()).toEqual(["envelope_balance", "envelope_card_list", "envelope_check_agent", "envelope_introduce", "envelope_receipt", "envelope_show"]);
      expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
      expect((await ro.call("envelope_pay", { amount: 1, payee: "designer@example.com", purpose: "design" })).rpcError).toMatchObject({ code: -32602 });
      expect((await ro.call("envelope_show")).text).toContain("ops-agent holds");
      expect((await gateway.envelope(rootId)).root.capturedMinor).toBe(7500);
    } finally { ro.stop(); }
  });

  it("never wrote a private key or anything that looks like a PayPal credential, to the client or to the gateway", async () => {
    const out = mcp.transcript.join("\n") + mcp.stderr();
    expect(mcp.transcript.length).toBeGreaterThan(15);
    expect(secrets.length).toBeGreaterThanOrEqual(4);
    for (const s of secrets) expect(out.includes(s)).toBe(false);
    expect(out.includes(FAKE_PAYPAL_SECRET)).toBe(false);
    expect(/client_secret|PAYPAL_CLIENT|access_token|Bearer |"kty"|"d"\s*:/i.test(out)).toBe(false);
    for (const s of http.seen) {
      for (const secret of secrets) expect(s.body.includes(secret)).toBe(false);
      expect(s.body.includes(FAKE_PAYPAL_SECRET)).toBe(false);
      expect(/"kty"|"d"\s*:/.test(s.body)).toBe(false);
    }
  });
});

/**
 * The command line, which is the same SDK behind a different front. Each command is a fresh process
 * with its keys in a temporary folder, against the same kind of local gateway.
 */
d("CLI over a local gateway (simulated PayPal)", () => {
  let http: Awaited<ReturnType<typeof startHttpGateway>>;
  let dir = "";
  const outputs: string[] = [];
  const cli = (args: string[]): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
    execFile(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/agent.ts", ...args], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GATEWAY: http.url, ENVELOPE_DIR: dir } as unknown as NodeJS.ProcessEnv, timeout: 30_000 }, (error, stdout, stderr) => {
      outputs.push(stdout, stderr);
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: stdout, err: stderr });
    });
  });
  const ok = async (args: string[]) => { const r = await cli(args); expect(r.err).toBe(""); expect(r.code).toBe(0); return r.out; };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  beforeAll(async () => {
    const { getDb } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    const { resetSimMemory } = await import("../lib/sim/store");
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
    resetSimMemory();
    http = await startHttpGateway();
    dir = mkdtempSync(join(tmpdir(), "envelope-cli-"));
  }, 60_000);
  afterAll(async () => { await http?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("an owner seals, agents split, pay, set aside and are refused, in the words the documentation quotes", async () => {
    expect((await ok(["keygen", "translator-agent"])).trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const opened = await ok(["open-account", "--as", "translator-agent", "--owner", "bea", "--settle-to", "bea@example.com", "--hold", "--per-payment", "30"]);
    expect(opened).toMatch(/^translator-agent can now be paid as acct:[0-9a-z-]{14} \(account [0-9A-Z-]{14}\)\. Income stays in its balance; it may pay at most \$30\.00 at once\. Withdrawals go to b•••@example\.com\./);
    const payee = /paid as (acct:\S+)/.exec(opened)![1]!;

    const sealed = await ok(["seal", "--as", "ada", "--to", "ops-agent", "--limit", "200", "--per", "80", "--payees", `${payee},designer@example.com`, "--purposes", "translation,design", "--hours", "2", "--splits", "2", "--title", "Launch budget"]);
    expect(sealed).toMatch(/^Sealed env_\S+ for ops-agent: up to \$200\.00 in total, at most \$80\.00 per payment/);
    expect(sealed).toMatch(/PayPal hold: authorization \S+ for \$200\.00/);

    const split = await ok(["split", "--as", "ops-agent", "--to", "localization-agent", "--limit", "60", "--payees", payee, "--purposes", "translation"]);
    expect(split).toContain("ops-agent gave localization-agent a sub-envelope: up to $60.00 in total, at most $60.00 per payment");
    expect(split).toContain("Announced to the gateway (the owner can see and revoke it).");
    const wide = await cli(["split", "--as", "localization-agent", "--to", "x-agent", "--limit", "10"]);
    expect(wide.code).toBe(1);
    expect(wide.err).toMatch(/^Refused locally: /);

    const paid = await ok(["pay", "--as", "localization-agent", "--amount", "45", "--payee", payee, "--purpose", "translation", "--memo", "FR strings", "--note", "Agreed quote"]);
    expect(paid).toMatch(new RegExp(`^PAID: \\$45\\.00 to ${esc(payee)}\\n  PayPal capture \\S+, credited to the payee agent's balance \\(no payout\\)\\n  Receipt: ${esc(http.url)}/r/\\S+`));
    const spendId = /\/r\/(\S+)/.exec(paid)![1]!;

    const denied = await cli(["pay", "--as", "localization-agent", "--amount", "5", "--payee", "attacker@evil.example", "--purpose", "translation"]);
    expect(denied.code).toBe(3);
    expect(denied.out).toMatch(/^DENIED\. Nothing was paid\.\n  PAYEE_NOT_ALLOWED: .+ \(.+\)/);

    const show = await ok(["show", "--as", "localization-agent"]);
    expect(show).toContain("localization-agent holds env_");
    expect(show).toContain("  ops-agent: $155.00 left of $200.00");
    expect(show).toContain("  localization-agent: $15.00 left of $60.00");

    const receipt = await ok(["receipt", spendId]);
    expect(receipt).toContain("PAID: $45.00");
    expect(receipt).not.toContain("FAIL");

    const promised = await ok(["promise", "--as", "ops-agent", "--amount", "30", "--payee", "designer@example.com", "--purpose", "design", "--minutes", "5"]);
    expect(promised).toMatch(/^SET ASIDE: \$30\.00 for designer@example\.com until \S+\. Promise pr_\S+/);
    const promiseId = /Promise (pr_\S+)/.exec(promised)![1]!;
    expect(await ok(["verify-promise", /this note: (\S+)/.exec(promised)![1]!])).toContain("signature valid");
    expect(await ok(["keep", promiseId, "--as", "ops-agent"])).toMatch(/^(PAID|PAYOUT_PENDING): the promise was paid\n  PayPal capture \S+, payout \S+ \(\S+\)\n  Receipt: /);

    const token = (await ok(["hello", "--as", "ops-agent", "--payee", "designer@example.com", "--amount", "40", "--purpose", "design"])).trim();
    const check = await ok(["check", token]);
    expect(check).toContain("GOOD. It can pay you up to");
    expect(check).toContain("signature valid");
  }, 120_000);

  it("the earning agent uses its balance and its card; the owner freezes, and closes the envelope", async () => {
    expect(await ok(["balance", "--as", "translator-agent"])).toMatch(/^translator-agent: \$45\.00 · may pay at most \$30\.00 at once/);
    await ok(["keygen", "proofreader-agent"]);
    const pr = await ok(["open-account", "--as", "proofreader-agent", "--owner", "bea", "--settle-to", "bea@example.com", "--hold"]);
    const proof = /paid as (acct:\S+)/.exec(pr)![1]!;
    const t = await ok(["transfer", "--as", "translator-agent", "--payee", proof, "--amount", "12", "--purpose", "proofreading"]);
    expect(t).toMatch(new RegExp(`^BOOKED: \\$12\\.00 to ${esc(proof)}\\. Balance now \\$33\\.00\\.\\n  Moved between accounts on the ledger; no PayPal call was needed\\.`));
    const drain = await cli(["transfer", "--as", "translator-agent", "--payee", "stranger@example.com", "--amount", "33"]);
    expect(drain.code).toBe(3);
    expect(drain.out).toMatch(/^DENIED\. Nothing moved\.\n  OVER_ACCOUNT_LIMIT: /);

    await ok(["keygen", "lexica"]);
    const lx = await ok(["open-account", "--as", "lexica", "--owner", "lexica-ltd", "--settle-to", "billing@lexica.example"]);
    const merchant = /paid as (acct:\S+)/.exec(lx)![1]!;
    const card = await ok(["card", "--as", "translator-agent", "--merchant", merchant, "--label", "Lexica Pro", "--per-charge", "9", "--charges", "2", "--every-seconds", "0", "--valid-days", "10"]);
    expect(card).toMatch(/^Card .+ \(card_\S+\) for lexica: at most \$9\.00 a charge, 2 charge\(s\), one per 0 s, until /);
    const cardId = /\((card_\S+)\)/.exec(card)![1]!;
    expect(await ok(["charge", "--as", "lexica", "--card", cardId, "--amount", "9", "--memo", "November"])).toMatch(/^(PAID|PAYOUT_PENDING): charged \$9\.00\. Charge 1 of 2\./);
    const over = await cli(["charge", "--as", "lexica", "--card", cardId, "--amount", "19"]);
    expect(over.code).toBe(3);
    expect(over.out).toMatch(/^DECLINED\. Nothing moved\.\n  OVER_CARD_LIMIT: /);
    expect(await ok(["cards", "--as", "translator-agent"])).toContain("1 of 2 used, $9.00 charged");
    expect(await ok(["cancel-card", "--as", "translator-agent", cardId])).toMatch(/is cancelled\. lexica cannot charge it again\. It was charged 1 time\(s\), \$9\.00 in all\./);

    expect(await ok(["freeze", "--as", "bea", "--agent", "translator-agent"])).toContain("translator-agent's account is frozen: nothing can leave its balance. Balance $24.00.");
    expect((await cli(["withdraw", "--as", "translator-agent", "--amount", "5"])).out).toContain("ACCOUNT_FROZEN");
    expect(await ok(["unfreeze", "--as", "bea", "--agent", "translator-agent"])).toContain("open again");
    expect(await ok(["withdraw", "--as", "translator-agent", "--amount", "5"])).toMatch(/^(PAID|PAYOUT_PENDING): \$5\.00 to the owner\. Balance now \$19\.00\.\n  PayPal payout \S+/);

    const books = await ok(["books"]);
    expect(books).not.toContain("FAIL");
    expect(await ok(["whois", "translator-agent"])).toContain("Can be paid as acct:");
    expect(await ok(["revoke", "--as", "ada", "--agent", "localization-agent"])).toContain("Revoked localization-agent's envelope and everything split from it.");
    expect(await ok(["close", "--as", "ada", "--agent", "ops-agent"])).toMatch(/^Closed\. PayPal released \$125\.00; \$75\.00 was charged\./);
  }, 120_000);

  it("printed no private key, and sent none", async () => {
    const all = outputs.join("\n");
    const keys = readdirSync(dir).filter((f) => f.endsWith(".key.json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).d as string);
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const k of keys) { expect(all.includes(k)).toBe(false); for (const s of http.seen) expect(s.body.includes(k)).toBe(false); }
  });
});

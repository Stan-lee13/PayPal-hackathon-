/**
 * MergePay's MCP server (Model Context Protocol, Streamable HTTP, stateless JSON responses), for
 * Cursor, Windsurf, Claude Code or any MCP client. Every call is authenticated with the freelancer's
 * bearer token (see app/api/mcp/route.ts).
 *
 * Tools that move money or change what the client receives (send, cancel, remind) require
 * `confirm: true`, and their descriptions tell the agent to get the developer's explicit go-ahead
 * first. Nothing here can change an amount: amounts come from the contract.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { clients, contracts, invoices } from "../db/schema";
import { UserFacingError } from "../errors";
import { formatMoney } from "../money";
import { cancelInvoice, draftInvoice, refreshInvoice, remindClient, sendInvoice } from "../services/invoices";
import { invoiceMarkdown, invoiceView } from "../services/views";
import { appBaseUrl } from "../base-url";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "mergepay", title: "MergePay — get paid for pull requests via PayPal", version: "1.0.0" };

const repoProp = { type: "string", description: "GitHub repository, owner/name (e.g. lagosroast/storefront).", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" };
const invoiceProp = { type: "string", description: "MergePay invoice id (starts with inv_), as returned by draft_invoice.", pattern: "^inv_[A-Za-z0-9_-]{8,40}$" };

export const MCP_TOOLS = [
  {
    name: "list_contracts",
    title: "List contracts",
    description: "List this developer's client contracts: repository, client, pricing (agreed price per issue, or hourly rate), whether the client accepted merge-on-payment, and the link to send the client to review the terms. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "draft_invoice",
    title: "Draft an invoice for a pull request",
    description: "Read a GitHub pull request and draft a PayPal invoice for it. Prices come from the contract (agreed price per closed issue, or stated hours × the agreed rate); you write no amounts. Returns line items with plain-language descriptions, a scope check that flags work the agreed issues don't cover (not billed), and warnings. Nothing is sent: show the draft to the developer and ask before calling send_invoice. Calling it again refreshes the draft.",
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        pr: { type: "integer", minimum: 1, description: "Pull request number." },
        hours: { type: "string", description: "Hourly contracts only: hours worked, as stated by the developer (e.g. \"6.5\"). Never estimate this yourself.", pattern: "^\\d{1,4}(\\.\\d{1,2})?$" },
        extras: {
          type: "array", maxItems: 5,
          description: "Only if the developer explicitly asks to bill work outside the agreed scope. Each is labelled on the invoice as a change request.",
          items: { type: "object", properties: { summary: { type: "string", minLength: 3, maxLength: 150 }, amount: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$", description: "Decimal amount stated by the developer, e.g. \"120.00\"." } }, required: ["summary", "amount"], additionalProperties: false },
        },
      },
      required: ["repo", "pr"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "send_invoice",
    title: "Send the invoice via PayPal",
    description: "Create the PayPal invoice for a draft and email it to the client, and post a note on the pull request. The PR then merges automatically once PayPal confirms full payment (if the client accepted those terms). Only call this after the developer has seen the draft and explicitly said to send it; pass confirm: true.",
    inputSchema: { type: "object", properties: { invoice_id: invoiceProp, confirm: { type: "boolean", description: "true only after the developer explicitly approved sending this exact draft." } }, required: ["invoice_id", "confirm"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "invoice_status",
    title: "Invoice status",
    description: "Check an invoice with PayPal (authoritative) and report whether it is sent, paid, merged or blocked, and why. If PayPal shows it paid, this also completes the merge (in case a webhook was missed). Give invoice_id, or repo + pr.",
    inputSchema: { type: "object", properties: { invoice_id: invoiceProp, repo: repoProp, pr: { type: "integer", minimum: 1 } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_invoices",
    title: "List invoices",
    description: "List this developer's invoices, newest first, optionally filtered by status (DRAFT, SENT, PAID, MERGED, MERGE_BLOCKED, CANCELLED). Read-only.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["DRAFT", "SENT", "PAID", "MERGED", "MERGE_BLOCKED", "CANCELLED"] }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "remind_client",
    title: "Remind the client",
    description: "Ask PayPal to email the client a reminder for a sent, unpaid invoice (PayPal allows two a day). Only when the developer asks; pass confirm: true.",
    inputSchema: { type: "object", properties: { invoice_id: invoiceProp, confirm: { type: "boolean" } }, required: ["invoice_id", "confirm"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "cancel_invoice",
    title: "Cancel an invoice",
    description: "Cancel a draft or sent (unpaid) invoice; PayPal tells the client. The PR will not merge from it. Only when the developer explicitly asks; pass confirm: true.",
    inputSchema: { type: "object", properties: { invoice_id: invoiceProp, confirm: { type: "boolean" } }, required: ["invoice_id", "confirm"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
] as const;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Rpc["id"], result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (t: string, structured?: unknown) => ({ content: [{ type: "text", text: t }], ...(structured === undefined ? {} : { structuredContent: structured }) });
const toolError = (t: string) => ({ isError: true, content: [{ type: "text", text: t }] });

const Args = {
  draft_invoice: z.object({ repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), pr: z.number().int().min(1), hours: z.string().optional(), extras: z.array(z.object({ summary: z.string().min(3).max(150), amount: z.string() })).max(5).optional() }).strict(),
  send_invoice: z.object({ invoice_id: z.string(), confirm: z.boolean() }).strict(),
  invoice_status: z.object({ invoice_id: z.string().optional(), repo: z.string().optional(), pr: z.number().int().optional() }).strict(),
  list_invoices: z.object({ status: z.enum(["DRAFT", "SENT", "PAID", "MERGED", "MERGE_BLOCKED", "CANCELLED"]).optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  remind_client: z.object({ invoice_id: z.string(), confirm: z.boolean() }).strict(),
  cancel_invoice: z.object({ invoice_id: z.string(), confirm: z.boolean() }).strict(),
  list_contracts: z.object({}).strict(),
};

/** Run one tool for an authenticated freelancer. Shared by the MCP endpoint and the browser playground. */
export async function callTool(freelancerId: string, name: string, rawArgs: unknown): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: unknown }> {
  const schema = (Args as Record<string, z.ZodTypeAny>)[name];
  if (!schema) return toolError(`Unknown tool: ${name}`);
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return toolError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
  const a = parsed.data as {
    repo: string; pr: number; hours?: string; extras?: Array<{ summary: string; amount: string }>;
    invoice_id: string; confirm: boolean; status?: "DRAFT" | "SENT" | "PAID" | "MERGED" | "MERGE_BLOCKED" | "CANCELLED"; limit?: number;
  };
  try {
    switch (name) {
      case "list_contracts": {
        const rows = await getDb().select({ c: contracts, client: clients }).from(contracts).innerJoin(clients, eq(clients.id, contracts.clientId)).where(eq(contracts.freelancerId, freelancerId));
        const out = rows.map(({ c, client }) => ({
          id: c.id, repo: c.repo, title: c.title, client: client.name, clientEmail: client.email, currency: c.currency, pricing: c.pricing,
          prices: c.pricing === "FIXED_PER_ISSUE" ? Object.fromEntries(Object.entries(c.issuePrices).map(([k, v]) => [`#${k}`, formatMoney(v, c.currency)])) : { hourly: c.hourlyRateMinor ? formatMoney(c.hourlyRateMinor, c.currency) : null, maxHoursPerInvoice: c.maxHoursPerInvoice },
          mergeOnPayment: c.mergeOnPayment, clientAccepted: Boolean(c.clientAcceptedAt), clientTermsLink: `${appBaseUrl()}/c/${c.clientToken}`,
        }));
        return text(out.length ? out.map((o) => `- ${o.repo} — ${o.title} for ${o.client} (${o.pricing === "FIXED_PER_ISSUE" ? Object.entries(o.prices).map(([k, v]) => `${k} ${v}`).join(", ") : `hourly ${(o.prices as { hourly: string }).hourly}`}); merge on payment: ${o.mergeOnPayment ? (o.clientAccepted ? "accepted by client" : "NOT yet accepted — send " + o.clientTermsLink) : "off"}`).join("\n") : "No contracts yet.", { contracts: out });
      }
      case "draft_invoice": {
        const inv = await draftInvoice({ freelancerId, repo: a.repo, pr: a.pr, hours: a.hours, extras: a.extras });
        return text(`${invoiceMarkdown(inv)}\n\nThis is a draft. Ask the developer whether to send it (send_invoice with confirm: true).`, invoiceView(inv));
      }
      case "send_invoice": {
        const inv = await sendInvoice({ freelancerId, invoiceId: a.invoice_id, confirm: a.confirm });
        return text(invoiceMarkdown(inv), invoiceView(inv));
      }
      case "invoice_status": {
        let id: string | undefined = a.invoice_id as string | undefined;
        if (!id) {
          if (!a.repo || !a.pr) return toolError("Give invoice_id, or repo and pr.");
          const row = await getDb().query.invoices.findFirst({ where: and(eq(invoices.freelancerId, freelancerId), eq(invoices.repo, a.repo), eq(invoices.prNumber, a.pr)), orderBy: desc(invoices.createdAt) });
          if (!row) return toolError(`No invoice for ${a.repo}#${a.pr}.`);
          id = row.id;
        }
        const { invoice, paypal } = await refreshInvoice({ freelancerId, invoiceId: id });
        return text(`${invoiceMarkdown(invoice)}${paypal ? `\n\nPayPal says: ${paypal.status}${paypal.paidMinor ? `, ${formatMoney(paypal.paidMinor, paypal.currency)} paid` : ""}${paypal.dueMinor ? `, ${formatMoney(paypal.dueMinor, paypal.currency)} due` : ""}.` : ""}`, { ...invoiceView(invoice), paypalStatus: paypal?.status ?? null });
      }
      case "list_invoices": {
        const rows = await getDb().query.invoices.findMany({ where: a.status ? and(eq(invoices.freelancerId, freelancerId), eq(invoices.status, a.status)) : eq(invoices.freelancerId, freelancerId), orderBy: desc(invoices.createdAt), limit: a.limit ?? 20 });
        return text(rows.length ? rows.map((r) => `- ${r.paypalInvoiceNumber ?? "draft"} · ${r.repo}#${r.prNumber} · ${formatMoney(r.amountMinor, r.currency)} · ${r.status} · ${r.id}`).join("\n") : "No invoices.", { invoices: rows.map(invoiceView) });
      }
      case "remind_client": {
        if (a.confirm !== true) return toolError("Not sent. Ask the developer first, then pass confirm: true.");
        const inv = await remindClient({ freelancerId, invoiceId: a.invoice_id });
        return text(`PayPal is emailing ${inv.paypalInvoiceNumber}'s client a reminder.`, invoiceView(inv));
      }
      case "cancel_invoice": {
        const inv = await cancelInvoice({ freelancerId, invoiceId: a.invoice_id, confirm: a.confirm });
        return text(invoiceMarkdown(inv), invoiceView(inv));
      }
    }
    return toolError(`Unknown tool: ${name}`);
  } catch (e) {
    if (e instanceof UserFacingError) return toolError(e.message);
    console.error("[mergepay] tool failed", name, e);
    return toolError("Something went wrong on MergePay's side. It has been logged.");
  }
}

/** Handle one JSON-RPC message for an authenticated freelancer. Returns null for notifications. */
export async function handleMcp(freelancerId: string, msg: Rpc): Promise<RpcResponse | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return ok(msg.id, {
        protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: "MergePay bills a client for a GitHub pull request through a PayPal invoice, and merges the PR once PayPal confirms payment. Typical flow: draft_invoice → show the draft to the developer → send_invoice(confirm: true) only when they say so → invoice_status later. Never invent prices or hours: prices come from the contract, hours from the developer.",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: MCP_TOOLS });
    case "tools/call":
      return ok(msg.id, await callTool(freelancerId, String(msg.params?.name ?? ""), msg.params?.arguments));
    default:
      return isNotification ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/**
 * Registers Kept's webhook with the PayPal app (sandbox/live) for the events Kept consumes.
 * Requires a PUBLIC HTTPS APP_BASE_URL. Prints the webhook id → put it in PAYPAL_WEBHOOK_ID.
 */
import { loadEnv } from "./env";
loadEnv();
const { getPayPal, paypalMode } = await import("../lib/paypal/client");
const { createWebhook, listWebhooks } = await import("../lib/paypal/api");
if (paypalMode() === "simulated") throw new Error("Set PAYPAL_CLIENT_ID/SECRET (PAYPAL_MODE=sandbox) first.");
const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!base.startsWith("https://")) throw new Error("APP_BASE_URL must be public https:// (PayPal only delivers to HTTPS on 443).");
const url = `${base}/api/webhooks/paypal`;
const existing = (await listWebhooks(getPayPal())).webhooks?.find((w) => w.url === url);
const id = existing?.id ?? (await createWebhook(getPayPal(), url)).id;
console.log(`${existing ? "Already registered" : "Registered"}: ${url}\nPAYPAL_WEBHOOK_ID=${id}`);

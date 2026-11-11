// The quick start from docs/SDK.md, as a file you can run:  GATEWAY=http://localhost:3000 node quickstart.mjs
import { Agent, Owner } from "@envelope/sdk";

const gateway = process.env.GATEWAY ?? "http://localhost:3000";
const owner = await Owner.generate({ gateway, label: "Ada" });          // a person; in the app this key lives in their browser
const agent = await Agent.generate({ gateway, label: "ops-agent" });    // the agent's own key, made on its machine

const { chain, root } = await owner.seal({ to: agent.identity, limit: "50.00", perPayment: "20.00", payees: ["designer@example.com"], purposes: ["design"], hours: 1 });
await agent.hold(chain);                                                // checked locally: every signature, back to the owner

const payment = await agent.pay({ amount: "12.50", payee: "designer@example.com", purpose: "design", memo: "Banner" });
console.log(`PayPal hold ${root.authorizationId}; capture ${payment.paypal?.captureId}; payout ${payment.paypal?.payoutBatchId}: ${payment.status}${payment.delivered ? "" : " (not delivered yet)"}`);
console.log((await (await agent.receipt(payment.spendId)).verify()).ok ? "Receipt verified on this machine." : "Receipt did NOT verify.");

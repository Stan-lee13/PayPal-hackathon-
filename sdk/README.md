# @envelope/sdk

Give an AI agent bounded spending authority of its own, backed by a PayPal hold.

```ts
import { Agent } from "@envelope/sdk";

const agent = await Agent.fromJSON(saved, { gateway: "http://localhost:3000" });
await agent.hold(chain); // an envelope a person sealed for this agent's key

const payment = await agent.pay({ amount: "45.00", payee: "translator@example.com", purpose: "translation" });
if (!payment.delivered) console.log(`PayPal says: ${payment.status}`);
```

The SDK signs with the agent's own key and talks only to an Envelope gateway. It never sees PayPal
credentials, and a request the envelope does not allow is refused at the gateway whatever the calling
code wants. Sandbox only.

Full guide: [`docs/SDK.md`](../docs/SDK.md). Build: `node sdk/build.mjs`. This package is marked
private and is not published to npm.

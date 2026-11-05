import { eq } from "drizzle-orm";
import { currentMerchant } from "@/lib/security/session";
import { getDb } from "@/lib/db";
import { merchants, sources } from "@/lib/db/schema";
import { and, isNull } from "drizzle-orm";
import { paypalMode } from "@/lib/paypal/client";
import { aiConfigured, aiModel } from "@/lib/ai/client";
import { demoModeEnabled } from "@/lib/clock";
import { PolicyForm } from "./policy-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const merchantId = (await currentMerchant())!;
  const db = getDb();
  const m = (await db.query.merchants.findFirst({ where: eq(merchants.id, merchantId) }))!;
  const srcs = await db.select().from(sources).where(and(eq(sources.merchantId, merchantId), isNull(sources.orderId)));
  return (
    <>
      <h1 className="quote text-3xl">Settings</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="pol-h">
          <h2 id="pol-h" className="eyebrow">Remedy policy</h2>
          <p className="mt-1 text-sm text-ink-soft">The deterministic policy engine enforces these on every AI or rules proposal, and again at approval time.</p>
          <PolicyForm policy={m.policy} />
        </section>
        <section aria-labelledby="src-h">
          <h2 id="src-h" className="eyebrow">Commitment sources</h2>
          <p className="mt-1 text-sm text-ink-soft">Per-order chat transcripts are snapshotted at checkout. The refund policy also yields enforceable promises. Shipping policy and promotions are context for the assistant.</p>
          <ul className="mt-2 space-y-2">{srcs.map((s) => <li key={s.id} className="paper p-3 text-sm"><p className="font-semibold">{s.title} <span className="eyebrow">{s.kind}</span></p><p className="quote mt-1">{s.text}</p></li>)}</ul>
          <h2 className="eyebrow mt-8">Configuration</h2>
          <dl className="mt-2 grid grid-cols-[10rem_1fr] gap-1 text-sm">
            <dt className="text-ink-soft">PayPal mode</dt><dd>{paypalMode()}</dd>
            <dt className="text-ink-soft">Webhook id set</dt><dd>{process.env.PAYPAL_WEBHOOK_ID ? "yes" : "no"}</dd>
            <dt className="text-ink-soft">AI</dt><dd>{aiConfigured() ? aiModel() : "not configured (deterministic fallbacks)"}</dd>
            <dt className="text-ink-soft">Demo mode</dt><dd>{demoModeEnabled() ? "on — simulated clock and demo pricing scenario (checkout ignores chat-advertised promotions)" : "off"}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

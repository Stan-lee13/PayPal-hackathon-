import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { activeProducts } from "@/lib/services/chat";
import { paypalMode } from "@/lib/paypal/client";
import { aiConfigured } from "@/lib/ai/client";
import { SHIPPING } from "@/lib/services/merchant-data";
import { Storefront } from "./storefront";

export const metadata: Metadata = { title: "Adaeze Studio (demo store)" };
export const dynamic = "force-dynamic";

export default async function StorePage() {
  const products = await activeProducts();
  return (
    <>
      <ModeBanner />
      <Storefront
        products={products.map((p) => ({ id: p.id, name: p.name, description: p.description, priceMinor: p.priceMinor, currency: p.currency, swatch: p.swatch, imageAlt: p.imageAlt, inStock: p.inStock }))}
        shipping={{ STANDARD: { label: SHIPPING.STANDARD.label, priceMinor: SHIPPING.STANDARD.priceMinor, line: SHIPPING.STANDARD.policyLine }, EXPRESS: { label: SHIPPING.EXPRESS.label, priceMinor: SHIPPING.EXPRESS.priceMinor, line: SHIPPING.EXPRESS.policyLine } }}
        mode={paypalMode()}
        paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
        aiEnabled={aiConfigured()}
      />
    </>
  );
}

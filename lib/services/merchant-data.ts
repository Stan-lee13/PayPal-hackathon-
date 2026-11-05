/**
 * Adaeze Studio — the clearly-labelled DEMONSTRATION merchant. All copy below is
 * the merchant's own published information; the AI assistant may only make
 * commitments grounded in it.
 */
import { DEFAULT_POLICY } from "./defaults";

export const DEMO_MERCHANT = {
  id: "mer_adaeze",
  slug: "adaeze-studio",
  name: "Adaeze Studio",
  currency: "USD",
  policy: DEFAULT_POLICY,
};

export const DEMO_PRODUCTS = [
  { id: "prd_ada_dress", sku: "ADA-WRAP-01", name: "Ada Wrap Dress", priceMinor: 8400, swatch: "#A23B2A", imageAlt: "Terracotta wrap dress in hand-dyed adire cotton", inStock: 12,
    description: "A wrap dress in hand-dyed adire cotton from Abeokuta. Adjustable waist tie, mid-calf length, machine washable cold." },
  { id: "prd_ife_scarf", sku: "IFE-SCARF-02", name: "Ìfẹ́ Silk Scarf", priceMinor: 2600, swatch: "#1F4E5A", imageAlt: "Deep teal silk scarf with indigo resist pattern", inStock: 30,
    description: "A 90cm square silk scarf with an indigo resist pattern. Hand-rolled edges." },
  { id: "prd_orun_kaftan", sku: "ORUN-KAFTAN-03", name: "Ọ̀run Kaftan", priceMinor: 12000, swatch: "#C9A227", imageAlt: "Ochre linen kaftan with embroidered neckline", inStock: 0,
    description: "Relaxed linen kaftan with hand-embroidered neckline. Currently sold out." },
] as const;

export const SHIPPING = {
  STANDARD: { label: "Standard", priceMinor: 450, shipsWithinHours: 120, policyLine: "Standard orders ship within 5 days of payment." },
  EXPRESS: { label: "Express", priceMinor: 933, shipsWithinHours: 48, policyLine: "Express orders ship within 48 hours of payment." },
} as const;

/** Threshold for the published free-express promotion. */
export const FREE_EXPRESS_THRESHOLD_MINOR = 7500;

export const DEMO_SOURCES = [
  { id: "src_refund_policy", kind: "REFUND_POLICY" as const, title: "Refund policy",
    text: "Returns are accepted within 30 days of delivery in original condition. Refunds are issued within 5 days of us receiving your return. Refunds go back to the original payment method." },
  { id: "src_shipping_policy", kind: "SHIPPING_POLICY" as const, title: "Shipping policy",
    text: `${SHIPPING.EXPRESS.policyLine} ${SHIPPING.STANDARD.policyLine} We ship from Lagos with tracking on every order. Delivery times depend on the carrier and are not guaranteed.` },
  { id: "src_promotions", kind: "PRODUCT_PAGE" as const, title: "Promotions",
    text: "This week: free express shipping on any order over $75. Promotion applies to the item subtotal before shipping." },
];

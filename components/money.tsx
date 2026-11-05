import { formatMoney, spokenMoney } from "@/lib/money";

export function Money({ minor, currency, className = "" }: { minor: number | null | undefined; currency: string | null | undefined; className?: string }) {
  if (minor === null || minor === undefined || !currency) return <span className={`money text-ink-soft ${className}`}>—</span>;
  return (
    <span className={`money ${className}`}>
      <span aria-hidden="true">{formatMoney(minor, currency)}</span>
      <span className="sr-only">{spokenMoney(minor, currency)}</span>
    </span>
  );
}

export function formatMoney(cents: number | null | undefined, currency = "USD", opts: { compact?: boolean } = {}): string {
  if (cents == null) return "—";
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: opts.compact || whole ? 0 : 2,
    maximumFractionDigits: opts.compact ? 0 : 2,
  }).format(cents / 100);
}

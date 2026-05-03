export type NumericLike = number | string | null | undefined;

export function toFiniteNumber(value: NumericLike): number | null {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function formatFixed(
  value: NumericLike,
  decimals: number,
  fallback = 'N/A',
): string {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) return fallback;
  return numericValue.toFixed(decimals);
}

export function formatInteger(value: NumericLike, fallback = 'N/A'): string {
  return formatFixed(value, 0, fallback);
}

export function formatGroupedInteger(value: NumericLike, fallback = 'N/A'): string {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) return fallback;
  return Math.round(numericValue).toLocaleString();
}

export function formatCompactThousands(
  value: NumericLike,
  decimals = 1,
  suffix = '',
  fallback = 'N/A',
): string {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null || numericValue <= 0) return fallback;
  const compactValue = `${formatFixed(numericValue / 1000, decimals, fallback)}k`;
  return suffix ? `${compactValue} ${suffix}` : compactValue;
}

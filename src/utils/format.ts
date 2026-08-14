export const formatNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '-';
  const rounded = Number(value.toFixed(digits));
  return String(rounded);
};

export const formatPercent = (value?: number): string => {
  if (value === undefined) return '-';
  return `${formatNumber(value * 100, 1)}%`;
};

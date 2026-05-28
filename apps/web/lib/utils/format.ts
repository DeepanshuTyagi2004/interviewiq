export function formatDate(input: string | number | Date): string {
  return new Date(input).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

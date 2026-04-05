export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function formatResponseTime(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

export function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString();
  } catch {
    return isoString;
  }
}

export function truncateUrl(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + "...";
}

export function formatTimeLabel(value: string): string {
  if (!value || !value.includes("T")) return value;
  return value.split("T")[1].substring(0, 5);
}

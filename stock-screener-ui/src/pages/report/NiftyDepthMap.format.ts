import { formatReportNum, formatReportOiCr } from "./reportFormat";

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmtStrike(s: number): string {
  return formatReportNum(num(s));
}

export function formatOiCompact(v: number): string {
  return formatReportOiCr(v, {
    lakh: 1,
    space: false,
    thousands: true,
    grouped: false,
  });
}

const istHm = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

/** IST wall-clock HH:MM for an epoch-ms value. Host-TZ independent. */
export function formatIstTimeMs(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return istHm.format(new Date(ms));
}

export function signedPctText(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function signedOiText(v: number): string {
  return `${v > 0 ? "+" : ""}${formatOiCompact(v)}`;
}

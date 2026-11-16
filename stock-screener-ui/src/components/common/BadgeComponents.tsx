import { Badge, type UISize } from "@/ui";

interface SideBadgeProps {
  side: string;
  size?: UISize;
  "data-testid"?: string;
}

export function SideBadge(props: SideBadgeProps) {
  const side = () => props.side;
  const isBuy = () => side().toUpperCase() === "BUY" || side().toUpperCase() === "LONG";
  const arrow = () => (side().toUpperCase() === "BUY" ? "▲" : side().toUpperCase() === "SELL" ? "▼" : "");
  return (
    <Badge color={isBuy() ? "success" : "error"} variant="filled" size="sm" data-testid={props["data-testid"]}>
      {arrow()} {side().toUpperCase()}
    </Badge>
  );
}

interface ExitReasonBadgeProps {
  reason: string;
  size?: UISize;
  "data-testid"?: string;
}

type ExitTone = "success" | "error" | "warning" | "info" | "secondary" | "neutral";

// Compact labels for the bare codes/human forms; rich reasons keep their original text.
const COMPACT_EXIT_LABELS: Record<string, string> = {
  tp: "TP",
  "take profit": "TP",
  target: "Target",
  sl: "SL",
  "stop loss": "SL",
  "trailing stop": "Trail",
  trail: "Trail",
  "force close": "Force",
  "force": "Force",
  "max holding": "Max Hold",
  "max hold": "Max Hold",
  "new 52w high": "52W High",
  "52w high": "52W High",
  "new 52w": "52W High",
  manual: "Manual",
  "manual close": "Manual",
};

export function ExitReasonBadge(props: ExitReasonBadgeProps) {
  const size = () => props.size ?? "sm";
  const raw = () => (props.reason == null ? "" : String(props.reason));
  // Enum codes and human strings use different separators/case; normalise both.
  const key = () => raw().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  const color = (): ExitTone => {
    const k = key();
    if (!k) return "neutral";
    // Priority follows the backend's decisive exit reason: a note can embed more
    // than one keyword (e.g. "52W Target exit: TRAILING_STOP"), and the trailing
    // token is the one that actually fired.
    if (/\bstop loss\b/.test(k) || /\bsl\b/.test(k)) return "error";
    if (/\btrail(ing)?\b/.test(k)) return "warning";
    if (/\bmax(imum)?\s?(holding|hold)\b/.test(k)) return "info";
    if (/\bforce\b/.test(k) || /\beod\b/.test(k) || /\bend of day\b/.test(k)) return "warning";
    if (/\b52w\b/.test(k)) return "success";
    if (/\btarget\b/.test(k) || /\btake profit\b/.test(k) || /\btp\b/.test(k)) return "success";
    if (/\bmanual\b/.test(k)) return "secondary";
    if (/\bstop\b/.test(k)) return "error";
    return "neutral";
  };

  const label = () => COMPACT_EXIT_LABELS[key()] ?? raw();

  return (
    <Badge color={color()} variant="filled" size={size()} data-testid={props["data-testid"]}>
      {label()}
    </Badge>
  );
}

export function TradingModeBadge(props: { liveTrading: boolean; size?: UISize }) {
  return (
    <Badge color={props.liveTrading ? "error" : "success"} variant="filled" size={props.size ?? "sm"}>
      {props.liveTrading ? "LIVE" : "PAPER"}
    </Badge>
  );
}

interface StatusBadgeProps {
  running: boolean;
  pid?: number;
  statusUnknown?: boolean;
  size?: UISize;
  "data-testid"?: string;
}

export function StatusBadge(props: StatusBadgeProps) {
  const running = () => props.running;
  const statusUnknown = () => props.statusUnknown;
  return (
    <Badge
      color={running() ? "success" : statusUnknown() ? "warning" : "error"}
      variant="filled"
      size={props.size ?? "sm"}
      data-testid={props["data-testid"]}
    >
      {running() ? "RUNNING" : statusUnknown() ? "UNKNOWN" : "STOPPED"}
      {props.pid != null ? ` #${props.pid}` : null}
    </Badge>
  );
}

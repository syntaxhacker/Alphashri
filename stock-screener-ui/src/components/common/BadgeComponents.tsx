import { Badge } from "@/ui";

interface SideBadgeProps {
  side: string;
  size?: string;
  "data-testid"?: string;
}

export function SideBadge({ side, size = "sm", "data-testid": testId }: SideBadgeProps) {
  const isBuy = side.toUpperCase() === "BUY" || side.toUpperCase() === "LONG";
  const arrow = side.toUpperCase() === "BUY" ? "▲" : side.toUpperCase() === "SELL" ? "▼" : "";
  return (
    <Badge color={isBuy ? "green" : "red"} variant="light" size={size} data-testid={testId}>
      {arrow} {side.toUpperCase()}
    </Badge>
  );
}

interface ExitReasonBadgeProps {
  reason: string;
  size?: string;
  "data-testid"?: string;
}

export function ExitReasonBadge({
  reason,
  size = "sm",
  "data-testid": testId,
}: ExitReasonBadgeProps) {
  let color: string = "gray";
  const r = (reason || "").toLowerCase().trim();
  if (r === "tp" || r === "target") color = "green";
  else if (r === "sl" || r === "stop_loss" || r.includes("stop loss")) color = "red";
  else if (r === "trailing_stop" || r === "trailing stop" || r.includes("trailing")) color = "orange";
  else if (r === "force_close" || r === "force close" || r === "forceclose") color = "violet";
  else if (r === "max_holding" || r === "max holding" || r.includes("max holding")) color = "yellow";
  else if (r === "new_52w_high" || r === "new 52w" || r.includes("52w")) color = "cyan";
  else if (r === "eod" || r === "manual_close" || r === "manual") color = "gray";
  else if (r.startsWith("stop loss hit") || r.startsWith("take profit")) color = r.includes("stop") ? "red" : "green";

  const label =
    r === "tp"
      ? "TP"
      : r === "sl"
        ? "SL"
        : r === "stop_loss"
          ? "SL"
          : r === "target"
            ? "Target"
            : r === "trailing_stop" || r === "trailing stop"
              ? "Trail"
              : r === "force_close" || r === "force close"
                ? "Force"
                : r === "max_holding" || r === "max holding"
                  ? "Max Hold"
                  : r === "new_52w_high"
                    ? "52W High"
                    : reason;

  return (
    <Badge color={color} variant="light" size={size} data-testid={testId}>
      {label}
    </Badge>
  );
}

export function TradingModeBadge({ liveTrading, size = "sm" }: { liveTrading: boolean; size?: "sm" | "md" | "lg" }) {
  return (
    <Badge color={liveTrading ? "red" : "green"} variant="filled" size={size}>
      {liveTrading ? "LIVE" : "PAPER"}
    </Badge>
  );
}

interface StatusBadgeProps {
  running: boolean;
  pid?: number;
  statusUnknown?: boolean;
  size?: string;
  "data-testid"?: string;
}

export function StatusBadge({
  running,
  pid,
  statusUnknown,
  size = "sm",
  "data-testid": testId,
}: StatusBadgeProps) {
  if (statusUnknown) {
    return (
      <Badge color="yellow" variant="light" size={size} data-testid={testId}>
        Unknown (Redis unavailable)
      </Badge>
    );
  }
  return (
    <Badge color={running ? "green" : "gray"} variant="light" size={size} data-testid={testId}>
      {running ? (pid ? `Running (PID ${pid})` : "Running") : "Stopped"}
    </Badge>
  );
}

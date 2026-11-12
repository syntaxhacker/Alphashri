import { Badge } from "@/ui";

interface SideBadgeProps {
  side: string;
  size?: string;
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
  size?: string;
  "data-testid"?: string;
}

export function ExitReasonBadge(props: ExitReasonBadgeProps) {
  const reason = () => props.reason;
  const size = () => props.size ?? "sm";
  let color: string = "secondary";
  const r = () => (reason() || "").toLowerCase().trim();
  const ladder = r();
  if (ladder === "tp" || ladder === "target") color = "success";
  else if (ladder === "sl" || ladder === "stop_loss" || ladder.includes("stop loss")) color = "error";
  else if (ladder === "trailing_stop" || ladder === "trailing stop" || ladder.includes("trailing")) color = "warning";
  else if (ladder === "force_close" || ladder === "force close" || ladder === "forceclose") color = "secondary";
  else if (ladder === "max_holding" || ladder === "max holding" || ladder.includes("max holding")) color = "warning";
  else if (ladder === "new_52w_high" || ladder === "new 52w" || ladder.includes("52w")) color = "info";
  else if (ladder === "eod" || ladder === "manual_close" || ladder === "manual") color = "secondary";
  else if (ladder.startsWith("stop loss hit") || ladder.startsWith("take profit")) color = ladder.includes("stop") ? "error" : "success";

  const rr = r();
  const label =
    rr === "tp"
      ? "TP"
      : rr === "sl"
        ? "SL"
        : rr === "stop_loss"
          ? "SL"
          : rr === "target"
            ? "Target"
            : rr === "trailing_stop" || rr === "trailing stop"
              ? "Trail"
              : rr === "force_close" || rr === "force close"
                ? "Force"
                : rr === "max_holding" || rr === "max holding"
                  ? "Max Hold"
                  : rr === "new_52w_high"
                    ? "52W High"
                    : reason();

  return (
    <Badge color={color} variant="filled" size={size()} data-testid={props["data-testid"]}>
      {label}
    </Badge>
  );
}

export function TradingModeBadge(props: { liveTrading: boolean; size?: "sm" | "md" | "lg" }) {
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
  size?: string;
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

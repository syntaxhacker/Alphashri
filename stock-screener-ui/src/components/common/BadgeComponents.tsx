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

export function ExitReasonBadge(props: ExitReasonBadgeProps) {
  const size = () => props.size ?? "sm";
  const r = () => (props.reason || "").toLowerCase().trim();

  const color = () => {
    const ladder = r();
    if (ladder === "tp" || ladder === "target") return "success";
    if (ladder === "sl" || ladder === "stop_loss" || ladder.includes("stop loss")) return "error";
    if (ladder === "trailing_stop" || ladder === "trailing stop" || ladder.includes("trailing")) return "warning";
    if (ladder === "max_holding" || ladder === "max holding" || ladder.includes("max holding")) return "warning";
    if (ladder === "new_52w_high" || ladder === "new 52w" || ladder.includes("52w")) return "info";
    if (ladder.startsWith("stop loss hit")) return "error";
    if (ladder.startsWith("take profit")) return "success";
    return "secondary";
  };

  const label = () => {
    const ladder = r();
    if (ladder === "tp") return "TP";
    if (ladder === "sl" || ladder === "stop_loss") return "SL";
    if (ladder === "target") return "Target";
    if (ladder === "trailing_stop" || ladder === "trailing stop") return "Trail";
    if (ladder === "force_close" || ladder === "force close") return "Force";
    if (ladder === "max_holding" || ladder === "max holding") return "Max Hold";
    if (ladder === "new_52w_high") return "52W High";
    return props.reason;
  };

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

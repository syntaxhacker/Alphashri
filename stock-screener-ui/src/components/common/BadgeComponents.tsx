import { Badge } from "@mantine/core";

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
  const r = (reason || "").toLowerCase();
  if (r === "tp" || r === "target") color = "green";
  else if (r === "sl" || r === "stop_loss") color = "red";
  else if (r === "trailing_stop" || r === "eod") color = "orange";

  const label =
    r === "tp"
      ? "TP"
      : r === "sl"
        ? "SL"
        : r === "stop_loss"
          ? "SL"
          : r === "target"
            ? "Target"
            : r === "trailing_stop"
              ? "Trail"
              : reason;

  return (
    <Badge color={color} variant="light" size={size} data-testid={testId}>
      {label}
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

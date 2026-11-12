import { Show } from "solid-js";
import type { JSX } from "solid-js";
// CollapsiblePanel — dense panel for the backtest right rail.
import { Badge, Divider, Text } from "@/ui";
import { IconChevronDown, IconChevronRight } from "@/components/common/Icons";
import type { BacktestPanelId } from "./useBacktestLayout";
import { Box, Stack } from "../paper-trading/primitives";

interface CollapsiblePanelProps {
  id: BacktestPanelId;
  title: string;
  badge?: JSX.Element;
  open: boolean;
  onToggle: () => void;
  children: JSX.Element;
}

export function CollapsiblePanel({ id, title, badge, open, onToggle, children }: CollapsiblePanelProps) {
  return (
    <Box
      data-testid={`panel-${id}`}
      data-open={open ? "true" : "false"}
      className="flex flex-col min-h-0 min-w-0 border-t border-fin-border"
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: open ? "1 1 0" : "0 0 auto",
        "min-height": 0,
        "min-width": 0,
        borderTop: "1px solid #30363D",
        "border-radius": 8,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
        className="flex w-full items-center gap-1.5 px-1.5 h-7.5 rounded-fin transition-colors"
        style={{
          width: "100%",
          height: 30,
          "padding-left": 8,
          "padding-right": 8,
          "justify-content": "flex-start",
          "background-color": open ? "#121212" : "#000000",
        }}
      >
        <Stack direction="row" align="center" gap={0.75} className="w-full">
          <Box className="place-items-center" style={{ display: "grid", placeItems: "center", color: "#8B949E" }}>
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Box>
          <Text
            size="xs"
            fw={700}
            c="text-primary"
            style={{
              "font-size": 10,
              "font-weight": 700,
              "letter-spacing": 0.6,
              flex: 1,
              "text-align": "left",
              "white-space": "nowrap",
              overflow: "hidden",
              "text-overflow": "ellipsis",
            }}
          >
            {title}
          </Text>
          {badge != null && (
            <Badge
              size="xs"
              style={{ height: 16, "font-size": 10, "font-weight": 700, "background-color": "#121212" }}
              variant="light"
            >
              {badge}
            </Badge>
          )}
        </Stack>
      </button>
      <Divider />
      <Show when={open}>
        <div className="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col">
          {children}
        </div>
      </Show>
    </Box>
  );
}

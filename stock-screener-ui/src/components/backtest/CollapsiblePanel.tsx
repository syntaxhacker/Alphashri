import { Show } from "solid-js";
import type { JSX } from "solid-js";
// CollapsiblePanel — dense panel for the backtest right rail.
import { Badge, Divider, Text, Box, Stack } from "@/ui";
import { IconChevronDown, IconChevronRight } from "@/components/common/Icons";
import type { BacktestPanelId } from "./useBacktestLayout";
interface CollapsiblePanelProps {
  id: BacktestPanelId;
  title: string;
  badge?: JSX.Element;
  open: boolean;
  onToggle: () => void;
  children: JSX.Element;
}

export function CollapsiblePanel(props: CollapsiblePanelProps) {
  return (
    <Box
      data-testid={`panel-${props.id}`}
      data-open={props.open ? "true" : "false"}
      className="flex flex-col min-h-0 min-w-0 border-t border-fin-border"
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: props.open ? "1 1 0" : "0 0 auto",
        "min-height": 0,
        "min-width": 0,
        "border-top": "1px solid #30363D",
        "border-radius": "8px",
      }}
    >
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-label={`${props.open ? "Collapse" : "Expand"} ${props.title}`}
        className="flex w-full items-center gap-1.5 px-1.5 h-7.5 rounded-fin transition-colors"
        style={{
          width: "100%",
          height: "30px",
          "padding-left": "8px",
          "padding-right": "8px",
          "justify-content": "flex-start",
          "background-color": props.open ? "#121212" : "#000000",
        }}
      >
        <Stack direction="row" align="center" gap={0.75} className="w-full">
          <Box className="place-items-center" style={{ display: "grid", "place-items": "center", color: "#8B949E" }}>
            {props.open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Box>
          <Text
            size="xs"
            fw={700}
            c="primary"
            style={{
              "font-size": "10px",
              "font-weight": 700,
              "letter-spacing": "0.6px",
              flex: 1,
              "text-align": "left",
              "white-space": "nowrap",
              overflow: "hidden",
              "text-overflow": "ellipsis",
            }}
          >
            {props.title}
          </Text>
          {props.badge != null && (
            <Badge
              size="xs"
              style={{ height: "16px", "font-size": "10px", "font-weight": 700, "background-color": "#121212" }}
              variant="light"
            >
              {props.badge}
            </Badge>
          )}
        </Stack>
      </button>
      <Divider />
      <Show when={props.open}>
        <div className="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col">
          {props.children}
        </div>
      </Show>
    </Box>
  );
}

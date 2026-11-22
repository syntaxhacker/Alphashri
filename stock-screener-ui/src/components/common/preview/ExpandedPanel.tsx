import { Show, createEffect, onCleanup, onMount } from "solid-js";
import {
  Paper,
  Group,
  Text,
  Select,
  CloseButton,
  Loader,
  ActionIcon,
  Box,
  Button,
  alpha,
} from "@/ui";
import * as palette from "@/ui/palette";
import type { ChartPreviewData } from "../../../api/chartPreview";
import { IconArrowsMaximize } from "../Icons";
import { buildChartOption } from "../../chart/chartRenderer";
import { loadEcharts } from "../../../utils/loadEcharts";
import { TIMEFRAMES, OR_MINUTES_OPTIONS } from "../../../config/constants";
import { RETRY_MESSAGE } from "./request";
import type { ChartInstanceBox } from "./types";

interface ExpandedPanelProps {
  symbol: string;
  data: ChartPreviewData | null;
  loading: boolean;
  error: string | null;
  timeframe: number;
  orMinutes: number;
  chartBox: ChartInstanceBox;
  onTimeframeChange: (val: string | null) => void;
  onOrMinutesChange: (val: string | null) => void;
  onClose: () => void;
  onOpenFull: (symbol: string) => void;
  onRetry: () => void;
}

export function ExpandedPanel(props: ExpandedPanelProps) {
  let containerRef: HTMLDivElement | undefined;
  let panelRef: HTMLElement | undefined;

  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => panelRef?.focus());
    // Capture phase with a popup check, mirroring Modal: an open timeframe
    // select owns Escape first, or one keypress would close both.
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute("role") === "combobox" && active.getAttribute("aria-expanded") === "true") return;
      if (active?.closest('[role="listbox"],[role="menu"]')) return;
      if (panelRef?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      props.onClose();
    };
    document.addEventListener("keydown", onDocKey, true);
    // aria-modal promises the page behind is inert; without this the user can
    // scroll the underlying list while the dialog is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    onCleanup(() => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onDocKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    });
  });

  createEffect(() => {
    const data = props.data;
    const container = containerRef;
    if (!data || !container) return;

    const chartOption = buildChartOption({
      symbol: data.symbol,
      candles: data.candles,
      orb_zones: data.orb_zones,
      pivot_levels: data.pivot_levels,
      high_52w: data.high_52w,
      size: "expanded",
      showPivots: true,
      show52wHigh: true,
    });

    if (!chartOption) return;

    let cancelled = false;
    const handleResize = () => props.chartBox.current?.resize();

    void loadEcharts().then((echartsLib) => {
      if (cancelled || !echartsLib) return;

      const chartDiv = container.querySelector(".echarts-container") as HTMLElement | null;
      if (!chartDiv) return;

      if (props.chartBox.current) {
        props.chartBox.current.dispose();
        props.chartBox.current = null;
      }

      const instance = echartsLib.init(chartDiv);
      props.chartBox.current = instance;
      instance.setOption(chartOption);
      instance.resize();

      window.addEventListener("resize", handleResize);
    });

    onCleanup(() => {
      cancelled = true;
      window.removeEventListener("resize", handleResize);
      if (props.chartBox.current) {
        props.chartBox.current.dispose();
        props.chartBox.current = null;
      }
    });
  });

  return (
    <>
      <div
        data-testid="preview-chart-backdrop"
        className="fixed inset-0"
        style={{ "z-index": 9999, "background-color": alpha(palette.BG, 0.55) }}
        onClick={props.onClose}
      />
      <Paper
        ref={(el: HTMLElement) => (panelRef = el)}
        shadow="xl"
        p={0}
        pos="fixed"
        top="50%"
        left="50%"
        w={650}
        h={480}
        role="dialog"
        aria-modal="true"
        aria-label={`${props.symbol} preview chart`}
        tabIndex={-1}
        style={{
          "z-index": 10000,
          transform: "translate(-50%, -50%)",
          display: "flex",
          "flex-direction": "column",
        }}
        data-testid="preview-chart-expanded"
      >
        <Group gap="md" px="md" py="xs" className="flex-shrink-0">
          <Text size="lg" fw={600} c="primary">
            {props.symbol}
            {props.data?.candles.length ? ` (${props.data.candles.length} candles)` : ""}
          </Text>
          <Select
            size="xs"
            w={70}
            data={TIMEFRAMES.map((t) => ({ value: String(t.value), label: t.label }))}
            value={String(props.timeframe)}
            onChange={props.onTimeframeChange}
            data-testid="preview-tf-select"
          />
          <Select
            size="xs"
            w={90}
            data={OR_MINUTES_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            value={String(props.orMinutes)}
            onChange={props.onOrMinutesChange}
            data-testid="preview-or-select"
          />
          <CloseButton className="ml-auto" size="md" onClick={props.onClose} data-testid="preview-close-btn" />
        </Group>

        <Box
          ref={(el: HTMLDivElement) => (containerRef = el)}
          style={{ flex: 1, padding: "8px", "min-height": "0px", position: "relative" }}
        >
          <Show when={props.loading}>
            <Box
              pos="absolute"
              inset={0}
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
              }}
            >
              <Loader />
            </Box>
          </Show>
          <Show when={!props.loading && props.error}>
            <Box
              pos="absolute"
              inset={0}
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                gap: "8px",
              }}
              data-testid="preview-chart-expanded-error"
            >
              <Text c="error" fw={600}>
                {RETRY_MESSAGE}
              </Text>
              <Show when={props.error !== RETRY_MESSAGE}>
                <Text size="xs" c="dimmed">
                  {props.error}
                </Text>
              </Show>
              <Button variant="outline" size="xs" onClick={props.onRetry} data-testid="preview-chart-retry">
                Retry
              </Button>
            </Box>
          </Show>
          <Show when={!props.loading && !props.error && (props.data?.candles.length ?? 0) === 0}>
            <Box
              pos="absolute"
              inset={0}
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
              }}
              data-testid="preview-chart-expanded-empty"
            >
              <Text c="dimmed">No data available</Text>
            </Box>
          </Show>
          <Show when={!props.loading && !props.error && (props.data?.candles.length ?? 0) > 0}>
            <div
              className="echarts-container"
              style={{ width: "100%", height: "100%", "min-height": "0px" }}
            />
          </Show>
        </Box>

        <Group justify="flex-end" px="md" py="xs" className="flex-shrink-0">
          <ActionIcon
            variant="subtle"
            color="primary"
            onClick={() => props.onOpenFull(props.symbol)}
            data-testid="preview-open-full-btn"
          >
            <IconArrowsMaximize size={16} />
          </ActionIcon>
          <Text
            size="xs"
            c="primary"
            style={{ cursor: "pointer" }}
            onClick={() => props.onOpenFull(props.symbol)}
            data-testid="preview-open-full-link"
          >
            Open Full Chart
          </Text>
        </Group>
      </Paper>
    </>
  );
}

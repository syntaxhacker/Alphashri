import { createEffect, onCleanup, Show } from "solid-js";
import {
  Modal,
  Group,
  Text,
  Select,
  CloseButton,
  Loader,
  ActionIcon,
  Box,
  Button,
} from "@/ui";
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

/** Expanded chart dialog: @/ui Modal owns the overlay, focus and dismissal. */
export function ExpandedPanel(props: ExpandedPanelProps) {
  let containerRef: HTMLDivElement | undefined;

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
    <Modal
      opened
      onClose={props.onClose}
      data-testid="preview-chart-expanded"
      {...({ "aria-label": `${props.symbol} preview chart` } as Record<string, unknown>)}
      size={650}
      padding={0}
      withCloseButton={false}
      style={{ width: "650px", height: "480px", "max-height": "480px", overflow: "hidden" }}
    >
      <div class="flex h-full min-h-0 flex-col">
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
      </div>
    </Modal>
  );
}

import { createMemo, Show } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import { formatVp } from "@/utils/optionsAnalyticsMath";
import { AnalyticsChartCore } from "./AnalyticsChartCore";
import { AnalyticsFooter } from "./AnalyticsFooter";
import { useChartInk } from "./chartInk";
import { buildTermOption, buildTermVM, TERM_HINT, type TermShape } from "./termChart";
import type { AnalyticsMetricVM } from "./types";

const BADGE_COLOR: Record<TermShape, string> = {
  backwardation: palette.NEGATIVE,
  contango: palette.POSITIVE,
  flat: palette.TEXT_MUTED,
};

/** ATM IV by expiry. Fewer than two finite points is not a term structure. */
export function TermPanel(props: { data: OptionsAnalytics; selectedExpiry: string | null }) {
  const ink = useChartInk();
  const vm = createMemo(() => buildTermVM(props.data, props.selectedExpiry));

  const option = createMemo(() => buildTermOption(vm(), ink()));

  const optionKey = createMemo(() => {
    const view = vm();
    return `${view.points.map((point) => `${point.label}|${point.dte}|${point.iv.toFixed(2)}`).join(";")}|sel${view.selected?.label ?? "x"}`;
  });

  const metrics = (): AnalyticsMetricVM[] => {
    const view = vm();
    const slope = view.slope;
    return [
      {
        label: `FRONT (${view.frontLabel})`,
        value: view.front ? view.front.iv.toFixed(1) : "—",
        testId: "term-metric-front",
      },
      {
        label: `BACK (${view.backLabel})`,
        value: view.back ? view.back.iv.toFixed(1) : "—",
        testId: "term-metric-back",
      },
      {
        label: "SLOPE (vp per expiry)",
        value: formatVp(slope),
        testId: "term-metric-slope",
        tone: slope == null ? undefined : slope > 0 ? "positive" : "negative",
      },
      {
        label: view.selectedLabel ? `SELECTED (${view.selectedLabel})` : "SELECTED",
        value: view.selected ? view.selected.iv.toFixed(1) : "—",
        testId: "term-metric-selected",
      },
    ];
  };

  return (
    <Box className="flex min-h-0 flex-1 flex-col" data-testid="analytics-term">
      <Show when={vm().badge}>
        {(badge) => (
          <Box className="shrink-0 px-2 pt-1">
            <Text
              size="xs"
              fw={700}
              className="uppercase"
              style={{
                "font-size": "10px",
                "letter-spacing": "0.04em",
                color: BADGE_COLOR[badge().shape],
              }}
              data-testid="term-badge"
            >
              {badge().text}
            </Text>
          </Box>
        )}
      </Show>
      <AnalyticsChartCore
        option={option()}
        optionKey={optionKey()}
        empty={vm().points.length < 2}
        emptyText="Need at least two expiries with valid ATM IV"
        testId="term-chart"
      />
      <Show when={vm().frontMissing}>
        <Box className="shrink-0 px-2 pb-0.5">
          <Text size="xs" c="dimmed" style={{ "font-size": "10px" }} data-testid="term-front-reason">
            FRONT ({vm().frontLabel}) · no IV quotes
          </Text>
        </Box>
      </Show>
      <Box className="shrink-0 px-2 pb-1">
        <Text size="xs" c="dimmed" className="truncate" style={{ "font-size": "10px" }} data-testid="term-hint">
          {TERM_HINT}
        </Text>
      </Box>
      <AnalyticsFooter metrics={metrics()} testId="term-footer" />
    </Box>
  );
}

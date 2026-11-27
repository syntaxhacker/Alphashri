import { For } from "solid-js";
import { Box } from "@/ui";
import { MetricCell } from "./MetricCell";
import type { AnalyticsMetricVM } from "./types";

/** The shared 24px metric band under every analytics canvas. */
export function AnalyticsFooter(props: { metrics: AnalyticsMetricVM[]; testId?: string }) {
  return (
    <Box
      className="flex h-[24px] shrink-0 items-stretch border-t border-fin-border"
      data-testid={props.testId ?? "analytics-footer"}
    >
      <For each={props.metrics}>
        {(metric, index) => (
          <MetricCell
            label={metric.label}
            value={metric.value}
            testId={metric.testId ?? `analytics-metric-${index() + 1}`}
            tone={metric.tone}
            bordered={index() > 0}
          />
        )}
      </For>
    </Box>
  );
}

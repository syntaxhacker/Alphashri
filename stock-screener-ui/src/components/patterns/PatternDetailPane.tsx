import { Box, Collapse, Divider, Loader, Text, ToolbarRow, UnstyledButton, useDisclosure } from "@/ui";
import { IconChevronDown } from "@tabler/icons-react";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { ChartCandle, ChartPayload, PatternHitDTO, SymbolDetail } from "@/types/chartPatterns";
import { formatChartTimestamp } from "./datetime";
import { PatternDetailChart } from "./PatternDetailChart";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";

export interface PatternDetailPaneProps {
  detail: SymbolDetail | null;
  detailChart: ChartPayload | null;
  loading: boolean;
  selectedSymbol: string | null;
  onExpand?: (hit: PatternHitDTO, candles: ChartCandle[]) => void;
}

function price(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value, 2);
}

function LabeledValue({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Text size="xs" c="dimmed" style={{ textTransform: "uppercase" }} fw={700} truncate>
        {label}
      </Text>
      <Text size="sm" fw={600} c={tone ?? "text.primary"} truncate>
        {value}
      </Text>
    </Box>
  );
}

/**
 * Collapsible audit list of the swing pivots that define the pattern, so a
 * trader can manually verify each turn against the chart. Renders nothing when
 * the hit carries no pivots (older persisted rows).
 */
export function PivotList({ pivots }: { pivots?: PatternHitDTO["pivots"] }) {
  const [opened, { toggle }] = useDisclosure(false);
  if (!pivots?.length) return null;
  return (
    <Box
      data-testid="patterns-detail-pivots"
      sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}
    >
      <UnstyledButton
        onClick={toggle}
        aria-expanded={opened}
        data-testid="patterns-detail-pivots-toggle"
        sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%", color: "text.secondary" }}
      >
        <IconChevronDown
          size={14}
          style={{ transform: opened ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
        <Text size="xs" fw={700} style={{ textTransform: "uppercase" }}>
          Pivots
        </Text>
        <Text size="xs" c="dimmed">
          ({pivots.length})
        </Text>
      </UnstyledButton>
      <Collapse in={opened}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, pt: 0.75 }}>
          {pivots.map((pivot, i) => (
            <Text
              key={`${pivot.t}-${i}`}
              size="xs"
              c="text.secondary"
              data-testid={`patterns-detail-pivot-${i}`}
            >
              {formatChartTimestamp(pivot.t)} · {price(pivot.price)} · {pivot.kind === "low" ? "Low" : "High"}
            </Text>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function explainerFor(hit: PatternHitDTO | null): string {
  if (!hit) return "";
  const notes = hit.notes?.trim();
  if (notes) return notes;
  return `A ${hit.direction} ${hit.pattern_name} on the ${hit.timeframe} chart. Price is ${hit.status} the breakout level at ${price(hit.breakout_level)}, with a ${hit.rr.toFixed(2)}:1 reward-to-risk.`;
}

/** Right-hand drill-down for the selected symbol. */
export function PatternDetailPane({ detail, detailChart, loading, selectedSymbol, onExpand }: PatternDetailPaneProps) {
  const focus = detail?.patterns?.[0] ?? null;
  const dayChange = detail?.day_change_pct ?? null;

  return (
    <Box
      data-testid="patterns-detail-pane"
      sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", p: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}
    >
      {!selectedSymbol ? (
        <Text size="sm" c="dimmed">
          Select a pattern to inspect its levels and history.
        </Text>
      ) : null}

      {selectedSymbol && loading && !detail ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 2 }}>
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading {selectedSymbol}…
          </Text>
        </Box>
      ) : null}

      {detail ? (
        <>
          <Box>
            <Text size="md" fw={700} truncate>
              {detail.name ?? detail.symbol}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {detail.symbol}
            </Text>
          </Box>

          <ToolbarRow justify="space-between" gap={1.5}>
            <LabeledValue label="Last close" value={price(detail.last_close)} />
            <LabeledValue
              label="Day"
              value={dayChange == null ? "—" : formatPercentage(dayChange, 2)}
              tone={dayChange == null ? undefined : getPnLTextColor(dayChange)}
            />
            <LabeledValue label="History" value={`${detail.history_bars} bars`} />
            <LabeledValue
              label="Patterns"
              value={`${detail.counts?.confirmed ?? 0} C / ${detail.counts?.forming ?? 0} F`}
            />
          </ToolbarRow>

          {detail.timeframes?.length ? (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {detail.timeframes.map((tf) => (
                <Box
                  key={tf.timeframe}
                  sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.25 }}
                >
                  <Text size="xs" c="dimmed">
                    {tf.timeframe} · {tf.count}
                  </Text>
                </Box>
              ))}
            </Box>
          ) : null}

          <Divider />
        </>
      ) : null}

      <PatternDetailChart
        payload={detailChart}
        hit={focus}
        loading={loading}
        onExpand={focus && onExpand ? () => onExpand(focus, detailChart?.candles ?? []) : undefined}
      />

      {detail ? (
        focus ? (
            <>
              <ToolbarRow justify="space-between" gap={1}>
                <ToolbarRow gap={1}>
                  <Text size="sm" fw={700}>
                    {focus.pattern_name}
                  </Text>
                  <StatusBadge status={focus.status} />
                </ToolbarRow>
                <QualityBadge quality={focus.quality} />
              </ToolbarRow>

              <ToolbarRow gap={1.5} justify="space-between" wrap={false}>
                <LabeledValue label="Breakout" value={price(focus.breakout_level)} tone="primary" />
                <LabeledValue label="Target" value={price(focus.target)} tone="success" />
                <LabeledValue label="Stop" value={price(focus.stop)} tone="error" />
                <LabeledValue label="R:R" value={focus.rr > 0 ? focus.rr.toFixed(2) : "—"} />
              </ToolbarRow>

              <ToolbarRow gap={1.5} justify="space-between">
                <LabeledValue label="Completed" value={focus.end_date || "—"} />
                <LabeledValue label="Spans" value={`${focus.start_date || "—"} → ${focus.end_date || "—"}`} />
                <LabeledValue label="Shape quality" value={focus.quality} />
              </ToolbarRow>

              <Box sx={{ borderLeft: "2px solid", borderColor: "primary.main", pl: 1 }}>
                <Text size="xs" c="dimmed" data-testid="patterns-detail-explainer">
                  {explainerFor(focus)}
                </Text>
              </Box>

              <PivotList pivots={focus.pivots} />
            </>
          ) : (
            <Text size="sm" c="dimmed">
              No patterns recorded for this symbol on the selected timeframe.
            </Text>
          )
        ) : null}
    </Box>
  );
}

import { memo, useMemo } from "react";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import {
  attributeNiftyPnl,
  formatPnlSigned,
  type NiftyPnlGreeks,
  type NiftyPnlPosition,
} from "./niftyPnlAttribution";

/** Segment opacity per component — green/red fill carries the sign. */
const SEG_OPACITY: Record<string, number> = {
  delta: 1,
  vega: 0.7,
  theta: 0.45,
  residual: 0.25,
};

const SEG_ORDER = ["delta", "vega", "theta", "residual"] as const;

interface NiftyPnlAttributionProps {
  positions?: NiftyPnlPosition[] | null;
  greeks?: NiftyPnlGreeks[] | null;
  spot?: number | null;
  defaultElapsedDays?: number;
  testId?: string;
}

/**
 * Per-leg stacked P&L attribution bar.
 *
 * Reading it: each leg is one diverging bar from a center zero line —
 * right is profit, left is loss. Segments are delta / vega / theta /
 * residual; GREEN is a gain, RED is a loss, and the legend maps opacity
 * to the component. The signed total beside each bar (and the panel
 * total) is green/red by sign.
 */
function NiftyPnlAttributionInner({
  positions,
  greeks,
  spot = null,
  defaultElapsedDays = 0,
  testId = "nifty-pnl",
}: NiftyPnlAttributionProps) {
  const { legs, total } = useMemo(
    () => attributeNiftyPnl(positions, greeks, spot, { defaultElapsedDays }),
    [positions, greeks, spot, defaultElapsedDays],
  );

  const hasPositions = Array.isArray(positions) && positions.length > 0;
  const hasGreeks = Array.isArray(greeks) && greeks.length > 0;

  if (!hasPositions || !hasGreeks) {
    return (
      <CompactPanel title="P&L attribution" testId={`${testId}-panel`}>
        <Box
          data-testid={`${testId}-empty`}
          className="flex items-center justify-center min-h-[120px]"
        >
          <Text size="xs" c="dimmed" span>
            No open positions
          </Text>
        </Box>
      </CompactPanel>
    );
  }

  const maxAbs = legs.reduce(
    (m, l) =>
      Math.max(
        m,
        Math.abs(l.delta) + Math.abs(l.vega) + Math.abs(l.theta) + Math.abs(l.residual),
        Math.abs(l.total),
      ),
    0,
  ) || 1;

  return (
    <CompactPanel title="P&L attribution" testId={`${testId}-panel`}>
      <Box className="flex flex-col gap-[6px] min-w-0">
        {legs.map((leg) => {
          const tone = leg.total > 0 ? palette.POSITIVE : leg.total < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
          const gains = SEG_ORDER.filter((k) => leg[k] > 0);
          const losses = SEG_ORDER.filter((k) => leg[k] < 0);
          return (
            <Box
              key={leg.key}
              data-testid={`${testId}-row-${leg.key}`}
              className="flex items-center gap-[8px] min-w-0"
            >
              <Box
                className="w-[132px] shrink-0 overflow-hidden truncate whitespace-nowrap"
              >
                <Text
                  size="xs"
                  span
                  fw={600}
                  title={leg.missingGreeks ? `${leg.label} · no greeks` : leg.label}
                >
                  {leg.label}
                </Text>
              </Box>
              <Box
                data-testid={`${testId}-bar-${leg.key}`}
                title={`${leg.label}: Δ ${formatPnlSigned(leg.delta)} · ν ${formatPnlSigned(leg.vega)} · θ ${formatPnlSigned(leg.theta)} · res ${formatPnlSigned(leg.residual)}`}
                className="relative flex-1 h-[10px] min-w-0"
                style={{
                  "background-color": palette.TERM_BG,
                  border: `1px solid ${palette.TERM_BORDER}`,
                  "border-radius": 4,
                  overflow: "hidden",
                }}
              >
                {/* center zero line */}
                <Box
                  aria-hidden
                  className="absolute left-[50%] top-0 bottom-0 w-[1px]"
                  style={{ "background-color": palette.CHART_BORDER }}
                />
                {/* losses grow left from center */}
                <Box
                  aria-hidden
                  className="absolute right-[50%] top-0 bottom-0 flex flex-row-reverse"
                >
                  {losses.map((k) => (
                    <Box
                      key={k}
                      data-testid={`${testId}-seg-${leg.key}-${k}`}
                      data-sign="loss"
                      className="h-full min-w-[1px]"
                      style={{
                        width: `${(Math.abs(leg[k] as number) / maxAbs) * 50}%`,
                        "background-color": palette.NEGATIVE,
                        opacity: SEG_OPACITY[k],
                      }}
                    />
                  ))}
                </Box>
                {/* gains grow right from center */}
                <Box
                  aria-hidden
                  className="absolute left-[50%] top-0 bottom-0 flex"
                >
                  {gains.map((k) => (
                    <Box
                      key={k}
                      data-testid={`${testId}-seg-${leg.key}-${k}`}
                      data-sign="gain"
                      className="h-full min-w-[1px]"
                      style={{
                        width: `${(leg[k] as number / maxAbs) * 50}%`,
                        "background-color": palette.POSITIVE,
                        opacity: SEG_OPACITY[k],
                      }}
                    />
                  ))}
                </Box>
              </Box>
              <Box
                className="w-[76px] shrink-0 text-right tabular-nums"
              >
                <Text
                  data-testid={`${testId}-total-${leg.key}`}
                  size="xs"
                  span
                  fw={700}
                  c={tone}
                >
                  {leg.missingGreeks ? "—" : formatPnlSigned(leg.total)}
                </Text>
              </Box>
            </Box>
          );
        })}

        <Box
          className="flex items-center justify-between gap-[8px] min-w-0"
          style={{ "border-top": `1px solid ${palette.TERM_BORDER}`, "padding-top": 4 }}
        >
          <Box
            data-testid={`${testId}-legend`}
            className="flex items-center gap-[8px] flex-wrap min-w-0"
          >
            {SEG_ORDER.map((k) => (
              <Box
                key={k}
                data-testid={`${testId}-legend-${k}`}
                className="flex items-center gap-[4px] shrink-0"
              >
                <Box
                  aria-hidden
                  className="w-[10px] h-[4px] rounded-[4px] shrink-0"
                  style={{ "background-color": palette.TEXT_MUTED, opacity: SEG_OPACITY[k] }}
                />
                <Text size="xs" c="dimmed" span>
                  {k === "residual" ? "res" : k}
                </Text>
              </Box>
            ))}
            <Box className="flex items-center gap-[4px] shrink-0">
              <Box
                aria-hidden
                className="w-[10px] h-[4px] rounded-[4px] shrink-0"
                style={{ "background-color": palette.POSITIVE }}
              />
              <Text size="xs" c="dimmed" span>profit</Text>
              <Box
                aria-hidden
                className="w-[10px] h-[4px] rounded-[4px] shrink-0"
                style={{ "background-color": palette.NEGATIVE }}
              />
              <Text size="xs" c="dimmed" span>loss</Text>
            </Box>
          </Box>
          <Text
            data-testid={`${testId}-total`}
            size="sm"
            span
            fw={700}
            c={total > 0 ? palette.POSITIVE : total < 0 ? palette.NEGATIVE : palette.TEXT_MUTED}
            style={{ "font-variant-numeric": "tabular-nums", "white-space": "nowrap" }}
          >
            {formatPnlSigned(total)}
          </Text>
        </Box>
      </Box>
    </CompactPanel>
  );
}

/** Memoised leaf panel — `positions`/`greeks` keep identity between parent renders. */
export const NiftyPnlAttribution = memo(NiftyPnlAttributionInner);
NiftyPnlAttribution.displayName = "NiftyPnlAttribution";

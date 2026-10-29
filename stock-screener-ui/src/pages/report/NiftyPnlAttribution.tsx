import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
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
          sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120 }}
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
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
        {legs.map((leg) => {
          const tone = leg.total > 0 ? palette.POSITIVE : leg.total < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
          const gains = SEG_ORDER.filter((k) => leg[k] > 0);
          const losses = SEG_ORDER.filter((k) => leg[k] < 0);
          return (
            <Box key={leg.key} data-testid={`${testId}-row-${leg.key}`} sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              <Box sx={{ width: 132, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Text size="xs" span fw={600} title={leg.missingGreeks ? `${leg.label} · no greeks` : leg.label}>
                  {leg.label}
                </Text>
              </Box>
              <Box
                data-testid={`${testId}-bar-${leg.key}`}
                title={`${leg.label}: Δ ${formatPnlSigned(leg.delta)} · ν ${formatPnlSigned(leg.vega)} · θ ${formatPnlSigned(leg.theta)} · res ${formatPnlSigned(leg.residual)}`}
                sx={{ position: "relative", flex: 1, height: 10, minWidth: 0, bgcolor: palette.TERM_BG, border: `1px solid ${palette.TERM_BORDER}`, borderRadius: 0.5, overflow: "hidden" }}
              >
                {/* center zero line */}
                <Box aria-hidden sx={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, bgcolor: palette.CHART_BORDER }} />
                {/* losses grow left from center */}
                <Box aria-hidden sx={{ position: "absolute", right: "50%", top: 0, bottom: 0, display: "flex", flexDirection: "row-reverse" }}>
                  {losses.map((k) => (
                    <Box
                      key={k}
                      data-testid={`${testId}-seg-${leg.key}-${k}`}
                      data-sign="loss"
                      sx={{ width: `${(Math.abs(leg[k]) / maxAbs) * 50}%`, height: "100%", minWidth: Math.abs(leg[k]) > 0 ? 1 : 0, bgcolor: palette.NEGATIVE, opacity: SEG_OPACITY[k] }}
                    />
                  ))}
                </Box>
                {/* gains grow right from center */}
                <Box aria-hidden sx={{ position: "absolute", left: "50%", top: 0, bottom: 0, display: "flex" }}>
                  {gains.map((k) => (
                    <Box
                      key={k}
                      data-testid={`${testId}-seg-${leg.key}-${k}`}
                      data-sign="gain"
                      sx={{ width: `${(leg[k] / maxAbs) * 50}%`, height: "100%", minWidth: leg[k] > 0 ? 1 : 0, bgcolor: palette.POSITIVE, opacity: SEG_OPACITY[k] }}
                    />
                  ))}
                </Box>
              </Box>
              <Box sx={{ width: 76, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <Text data-testid={`${testId}-total-${leg.key}`} size="xs" span fw={700} c={tone}>
                  {leg.missingGreeks ? "—" : formatPnlSigned(leg.total)}
                </Text>
              </Box>
            </Box>
          );
        })}

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, borderTop: `1px solid ${palette.TERM_BORDER}`, pt: 0.5 }}>
          <Box data-testid={`${testId}-legend`} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", minWidth: 0 }}>
            {SEG_ORDER.map((k) => (
              <Box key={k} data-testid={`${testId}-legend-${k}`} sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                <Box aria-hidden sx={{ width: 10, height: 6, borderRadius: 0.5, bgcolor: palette.TEXT_MUTED, opacity: SEG_OPACITY[k] }} />
                <Text size="xs" c="dimmed" span>{k === "residual" ? "res" : k}</Text>
              </Box>
            ))}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
              <Box aria-hidden sx={{ width: 10, height: 6, borderRadius: 0.5, bgcolor: palette.POSITIVE }} />
              <Text size="xs" c="dimmed" span>profit</Text>
              <Box aria-hidden sx={{ width: 10, height: 6, borderRadius: 0.5, bgcolor: palette.NEGATIVE }} />
              <Text size="xs" c="dimmed" span>loss</Text>
            </Box>
          </Box>
          <Text
            data-testid={`${testId}-total`}
            size="sm"
            span
            fw={700}
            c={total > 0 ? palette.POSITIVE : total < 0 ? palette.NEGATIVE : palette.TEXT_MUTED}
            sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
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

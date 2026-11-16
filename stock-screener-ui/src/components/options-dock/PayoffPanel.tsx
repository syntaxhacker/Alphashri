import { createSignal } from "solid-js";
import { Box, Text } from "@/ui";
import type { DockLeg } from "@/state/optionsDock";
import { DockSection } from "./DockSection";
import { PayoffChartCore, formatPop, type PayoffSnapshot } from "./PayoffChartCore";

// Kept here as well as in the core: the dock and their tests import the pure
// model from the panel's original public surface.
export { buildPayoff, formatPop } from "./PayoffChartCore";
export type { PayoffSnapshot } from "./PayoffChartCore";

/**
 * The dock's PAYOFF band. Chrome and the POP readout live here; the ECharts
 * canvas, guides and four-cell footer are the shared `PayoffChartCore` so the
 * F&O row detail renders exactly the same picture of a position.
 */
export function PayoffPanel(props: {
  legs: DockLeg[];
  spot: number;
  /** ATM IV in vol points (13.8 = 13.8 %), `null` when the feed quotes none. */
  iv: number | null;
  dteYears: number;
}) {
  // Published by the core's single gated recompute — no second payoff integral.
  const [snapshot, setSnapshot] = createSignal<PayoffSnapshot | null>(null);

  const ivDecimal = () => {
    const iv = props.iv;
    return iv != null && Number.isFinite(iv) && iv > 0 ? iv / 100 : Number.NaN;
  };

  return (
    <DockSection
      title="PAYOFF"
      testId="options-payoff"
      headerTestId="dock-section-payoff"
      fill
      padded={false}
      meta={
        <Box className="flex items-baseline gap-1.5">
          <Text size="xs" c="dimmed" className="uppercase" style={{ "font-size": "9px" }}>
            POP
          </Text>
          <Text
            size="xs"
            fw={700}
            className="font-mono tabular-nums"
            style={{ "font-size": "10px" }}
            data-testid="options-pop"
          >
            {snapshot() ? formatPop(snapshot()!.pop) : "—"}
          </Text>
        </Box>
      }
    >
      <Box className="flex min-h-0 flex-1 flex-col" style={{ "min-height": "96px" }}>
        <PayoffChartCore
          legs={props.legs}
          spot={props.spot}
          iv={ivDecimal()}
          dteYears={props.dteYears}
          onSnapshot={setSnapshot}
        />
      </Box>
    </DockSection>
  );
}

import { For, Show } from "solid-js";
import { Box, Text, Tooltip } from "@/ui";
import * as palette from "@/ui/palette";
import { IconMinus, IconPlus, IconTrash } from "@/components/common/Icons";
import { formatNumber } from "@/utils/ui-helpers";
import { MAX_LEGS, setLegLots, removeLeg, toggleLegSide, type DockLeg } from "@/state/optionsDock";
import { DockSection } from "./DockSection";

/**
 * Legs strip: one chip per leg (`S 24200 CE ×1 @36.6 ✕`), a buy/sell toggle and
 * a lots stepper. Nothing here issues a request — the payoff is recomputed from
 * the in-memory frame.
 */
export function LegBuilder(props: {
  legs: DockLeg[];
  netPremium: number;
  currentExpiry: string | null;
  /** Optional host hook; the store removal already happened. */
  onRemove?: (key: string) => void;
}) {
  const staleCount = () =>
    props.currentExpiry
      ? props.legs.filter((leg) => leg.expiry !== props.currentExpiry).length
      : 0;

  return (
    <DockSection
      title="LEGS"
      testId="options-legs"
      headerTestId="dock-section-legs"
      meta={
        <Box className="flex items-baseline gap-2">
          <Text
            size="xs"
            c="dimmed"
            className="font-mono tabular-nums"
            style={{ "font-size": "10px" }}
            data-testid="options-leg-count"
          >
            {props.legs.length}/{MAX_LEGS}
          </Text>
          <Text size="xs" c="dimmed" className="uppercase" style={{ "font-size": "9px" }}>
            {props.netPremium >= 0 ? "net credit" : "net debit"}
          </Text>
          <Text
            size="xs"
            fw={700}
            c={props.netPremium >= 0 ? "success" : "error"}
            className="font-mono tabular-nums"
            style={{ "font-size": "10px" }}
            data-testid="options-net-premium"
          >
            ₹{formatNumber(Math.abs(props.netPremium))}
          </Text>
        </Box>
      }
    >
      <Show
        when={props.legs.length > 0}
        fallback={
          <Text size="xs" c="dimmed" data-testid="options-legs-empty">
            Click a chain price to add a leg · shift-click to sell
          </Text>
        }
      >
        <Box className="flex flex-wrap gap-1" data-testid="options-leg-chips">
          <For each={props.legs}>
            {(leg) => (
              <Box
                className="inline-flex items-center gap-1 rounded-[4px] border border-fin-border bg-fin-surface-alt px-1 py-[1px]"
                data-testid={`options-leg-${leg.type}-${leg.strike}`}
              >
                <Tooltip label={leg.side === "sell" ? "Switch to buy" : "Switch to sell"}>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`${leg.type} ${leg.strike} ${leg.side} — toggle side`}
                    data-testid={`options-leg-side-${leg.type}-${leg.strike}`}
                    onClick={() => toggleLegSide(leg.key)}
                    className="border-0 bg-transparent p-0 font-mono text-[10px] font-bold uppercase"
                    style={{ color: leg.side === "sell" ? palette.NEGATIVE : palette.POSITIVE }}
                  >
                    {leg.side === "sell" ? "S" : "B"}
                  </Box>
                </Tooltip>
                <Text size="xs" fw={700} className="font-mono tabular-nums" style={{ "font-size": "10px" }}>
                  {leg.strike}
                </Text>
                <Text
                  size="xs"
                  c="dimmed"
                  className="font-mono uppercase"
                  style={{ "font-size": "10px" }}
                >
                  {leg.type}
                </Text>

                <Box className="inline-flex items-center">
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Reduce ${leg.type} ${leg.strike} lots`}
                    data-testid={`options-leg-lots-down-${leg.type}-${leg.strike}`}
                    onClick={() => setLegLots(leg.key, leg.lots - 1)}
                    className="border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-text"
                  >
                    <IconMinus size={12} />
                  </Box>
                  <Text
                    size="xs"
                    className="font-mono tabular-nums"
                    style={{ "font-size": "10px", "min-width": "14px", "text-align": "center" }}
                    data-testid={`options-leg-lots-${leg.type}-${leg.strike}`}
                  >
                    ×{leg.lots}
                  </Text>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Increase ${leg.type} ${leg.strike} lots`}
                    data-testid={`options-leg-lots-up-${leg.type}-${leg.strike}`}
                    onClick={() => setLegLots(leg.key, leg.lots + 1)}
                    className="border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-text"
                  >
                    <IconPlus size={12} />
                  </Box>
                </Box>

                <Text size="xs" c="dimmed" className="font-mono tabular-nums" style={{ "font-size": "10px" }}>
                  @{leg.premium.toFixed(1)}
                </Text>
                <Box
                  component="button"
                  type="button"
                  aria-label={`Remove ${leg.type} ${leg.strike}`}
                  data-testid={`options-leg-remove-${leg.type}-${leg.strike}`}
                  onClick={() => {
                    removeLeg(leg.key);
                    props.onRemove?.(leg.key);
                  }}
                  className="border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-negative"
                >
                  <IconTrash size={12} />
                </Box>
              </Box>
            )}
          </For>
        </Box>
      </Show>

      <Show when={staleCount() > 0}>
        <Text size="xs" c="warning" data-testid="options-legs-expiry-mismatch">
          {staleCount()} leg{staleCount() === 1 ? "" : "s"} on a different expiry
        </Text>
      </Show>
    </DockSection>
  );
}

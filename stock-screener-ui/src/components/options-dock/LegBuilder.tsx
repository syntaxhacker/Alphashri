import { For, Show } from "solid-js";
import { Box, Tooltip } from "@/ui";
import { IconMinus, IconPlus, IconTrash } from "@/components/common/Icons";
import { EmptyState } from "@/components/common/states";
import { formatNumber } from "@/utils/ui-helpers";
import { MAX_LEGS, setLegLots, removeLeg, toggleLegSide, type DockLeg } from "@/state/optionsDock";
import { DockSection } from "./DockSection";

/**
 * Legs strip: one chip per leg (`S 24200 CE ×1 @36.6 ✕`), a buy/sell toggle and
 * a lots stepper. Nothing here issues a request — the payoff is recomputed from
 * the in-memory frame. Every fragment is at least 11px and gapped by 8px so the
 * chip reads as a list of facts rather than one 10px run.
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
          <Box
            component="span"
            className="font-mono tabular-nums text-[11px] leading-[14px] text-fin-text-muted"
            data-testid="options-leg-count"
          >
            {props.legs.length}/{MAX_LEGS}
          </Box>
          <Box
            component="span"
            className="text-[11px] leading-[14px] uppercase text-fin-text-muted"
          >
            {props.netPremium >= 0 ? "net credit" : "net debit"}
          </Box>
          <Box
            component="span"
            className={`font-mono tabular-nums text-[11px] leading-[14px] font-bold ${
              props.netPremium >= 0 ? "text-fin-positive" : "text-fin-negative"
            }`}
            data-testid="options-net-premium"
          >
            ₹{formatNumber(Math.abs(props.netPremium))}
          </Box>
        </Box>
      }
    >
      <Show
        when={props.legs.length > 0}
        fallback={
          <EmptyState
            data-testid="options-legs-empty"
            kind="no-data"
            layout="row"
            className="text-[11px]"
            title="No legs yet"
            description="Click a chain price to add a leg · shift-click to sell"
          />
        }
      >
        <Box className="flex flex-wrap gap-2" data-testid="options-leg-chips">
          <For each={props.legs}>
            {(leg) => (
              <Box
                className="inline-flex items-center gap-2 rounded-md border border-fin-border-subtle bg-fin-surface-alt px-2 py-1"
                data-testid={`options-leg-${leg.type}-${leg.strike}`}
              >
                <Tooltip label={leg.side === "sell" ? "Switch to buy" : "Switch to sell"}>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`${leg.type} ${leg.strike} ${leg.side} — toggle side`}
                    data-testid={`options-leg-side-${leg.type}-${leg.strike}`}
                    onClick={() => toggleLegSide(leg.key)}
                    className="border-0 bg-transparent p-0 font-mono text-[11px] leading-[14px] font-bold uppercase"
                    style={{
                      color:
                        leg.side === "sell" ? "var(--color-fin-negative)" : "var(--color-fin-positive)",
                    }}
                  >
                    {leg.side === "sell" ? "S" : "B"}
                  </Box>
                </Tooltip>
                <Box
                  component="span"
                  className="font-mono tabular-nums text-[11px] leading-[14px] font-bold text-fin-text"
                >
                  {leg.strike}
                </Box>
                <Box
                  component="span"
                  className="font-mono text-[11px] leading-[14px] uppercase text-fin-text-muted"
                >
                  {leg.type}
                </Box>

                <Box className="inline-flex items-center gap-2">
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
                  <Box
                    component="span"
                    className="min-w-[14px] text-center font-mono tabular-nums text-[11px] leading-[14px]"
                    data-testid={`options-leg-lots-${leg.type}-${leg.strike}`}
                  >
                    ×{leg.lots}
                  </Box>
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

                <Box
                  component="span"
                  className="font-mono tabular-nums text-[11px] leading-[14px] text-fin-text-muted"
                >
                  @{leg.premium.toFixed(1)}
                </Box>
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
        <Box
          component="span"
          className="border-l-2 border-fin-border-warning pl-2 text-[11px] leading-4 text-fin-warning"
          data-testid="options-legs-expiry-mismatch"
        >
          {staleCount()} leg{staleCount() === 1 ? "" : "s"} on a different expiry
        </Box>
      </Show>
    </DockSection>
  );
}

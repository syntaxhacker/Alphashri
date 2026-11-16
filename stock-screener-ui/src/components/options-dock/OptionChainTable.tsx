import { Show, createMemo, type JSX } from "solid-js";
import { Box, useMediaQuery } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { ChainLeg, ChainRow } from "@/api/optionsDock";
import { chainColumns } from "./chain.columns";

/** Below Tailwind's `sm` the chain drops to a one-sided 5-column layout. */
export const CHAIN_NARROW_QUERY = "(max-width: 639px)";

/** 5 columns × their declared sizes (54+38+34+52+72) — fits a 390px sheet. */
const NARROW_MIN_TABLE_WIDTH = 250;

// Theme-aware tint: mixing the primary into the *current* surface keeps the ATM
// row legible in both schemes (an inline palette rgba() sat on a dark literal
// and measured 1.11:1 in light mode). The expression lives in a custom property
// because a bare color-mix() in `background-color` is silently dropped by
// DOM style shims; browsers resolve the var() on paint.
const ATM_BG_STYLE = {
  "--atm-tint": "color-mix(in srgb, var(--color-fin-primary) 8%, var(--color-fin-surface))",
  "background-color": "var(--atm-tint)",
} as JSX.CSSProperties;

/**
 * The dock's chain table. One shared `TanStackTable`, 60-row window, no bespoke
 * renderer: the CE/PE halves are just columns with explicit `meta.align`.
 *
 * Cells read their row's plain data (`row.original.ce.ltp`); nothing subscribes
 * per row, which is what keeps a 10 s frame patch cheap.
 */
export function OptionChainTable(props: {
  rows: ChainRow[];
  spot: number;
  loading?: boolean;
  /** Selected side for the narrow layout; ignored at ≥640px. */
  side?: "CE" | "PE";
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
}) {
  const narrow = useMediaQuery(CHAIN_NARROW_QUERY);

  const atmStrike = createMemo(() => {
    const spot = props.spot;
    if (!(spot > 0) || props.rows.length === 0) return null;
    let best = props.rows[0].strike;
    let bestDistance = Math.abs(best - spot);
    for (const row of props.rows) {
      const distance = Math.abs(row.strike - spot);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row.strike;
      }
    }
    return best;
  });

  const maxOi = createMemo(() => {
    let max = 0;
    for (const row of props.rows) {
      if (row.ce.oi > max) max = row.ce.oi;
      if (row.pe.oi > max) max = row.pe.oi;
    }
    return max;
  });

  const columns = createMemo(() =>
    chainColumns({
      maxOi,
      atmStrike,
      // Gated on `narrow` so a side passed while wide can never shrink the
      // nine-column desktop layout.
      side: narrow() ? (props.side ?? "CE") : undefined,
      onPick: (strike, type, leg, side) => props.onPick?.(strike, type, leg, side),
    }),
  );

  return (
    <Box className="flex min-h-0 flex-1 flex-col" data-testid="options-chain-table">
      <TanStackTable<ChainRow>
        data={props.rows}
        columns={columns()}
        rowWindowSize={60}
        dense
        fillContainer
        bare
        enableSorting
        stickyHeader
        minTableWidth={narrow() ? NARROW_MIN_TABLE_WIDTH : 428}
        dataTestId="options-chain"
        ariaLabel="Option chain"
        loading={props.loading}
        loadingMessage="Loading chain…"
        emptyMessage="No strikes listed for this expiry"
        getRowTestId={(row) => `options-chain-row-${row.strike}`}
        getRowStyle={(row) => (row.strike === atmStrike() ? ATM_BG_STYLE : undefined)}
        getRowAttributes={(row) => ({ "data-atm": row.strike === atmStrike() ? "true" : undefined })}
        initialState={{ sorting: [{ id: "strike", desc: false }] }}
      />
      <Show when={props.rows.length === 0 && !props.loading}>
        <Box className="sr-only" data-testid="options-chain-empty">
          No strikes listed for this expiry
        </Box>
      </Show>
    </Box>
  );
}

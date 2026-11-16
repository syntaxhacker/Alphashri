import { Show, createMemo } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { ChainLeg, ChainRow } from "@/api/optionsDock";
import { chainColumns } from "./chain.columns";

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
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
}) {
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
    chainColumns({ maxOi, onPick: (strike, type, leg, side) => props.onPick?.(strike, type, leg, side) }),
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
        minTableWidth={428}
        dataTestId="options-chain"
        ariaLabel="Option chain"
        loading={props.loading}
        loadingMessage="Loading chain…"
        emptyMessage="No strikes listed for this expiry"
        getRowTestId={(row) => `options-chain-row-${row.strike}`}
        getRowStyle={(row) =>
          row.strike === atmStrike()
            ? { "background-color": palette.alpha(palette.PRIMARY, 0.08) }
            : undefined
        }
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

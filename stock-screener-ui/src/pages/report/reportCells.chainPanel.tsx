import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button } from "@/ui";
import * as palette from "@/ui/palette";
import { hexToRgba } from "@/utils/color";
import { CompactPanel } from "@/components/common/compact";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import type { NiftyStrike } from "@/types/niftyReport";
import { OI_CHAIN_METRICS } from "./reportCells.chainMetrics";
import { ReportPanelTitle } from "./reportCells.decision";

const OI_CHAIN_PANEL_CLASS = "min-w-0 min-h-0";
const OI_CHAIN_PANEL_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_BG,
  "border-color": palette.TERM_BORDER,
  // `contain: size` made the panel's intrinsic height zero, so the parent's
  // flex:1 stretched a five-row chain across the whole chart row. Layout/paint
  // isolation without size containment lets the panel hug its real rows.
  contain: "layout paint",
  flex: "0 0 auto",
  "align-self": "flex-start",
};

/** Real ATM/wall row emphasis — no placeholder tint on the other rows. */
const OI_CHAIN_FOCUS_STYLE: JSX.CSSProperties = {
  "background-color": hexToRgba(palette.TERM_FLIP, 0.16),
  "box-shadow": `inset 3px 0 0 ${palette.TERM_FLIP}`,
};

/**
 * TanStackTable paints padding/height/size inline on every cell. An `!important`
 * rule on the cell itself is the only way to keep the chain's own rhythm
 * without forking the shared table (a custom property on an ancestor loses to
 * the table's inline declaration). Font sizes reference the shared `--text-ui-*`
 * tokens, never a private px literal. `overflow-x: auto` is the real scroll cue
 * at 390: the seven-column chain keeps its full width instead of tearing values
 * mid-word to fit the phone.
 */
const OI_CHAIN_WRAP_CLASS = [
  "flex min-w-0 min-h-0 overflow-x-auto",
  "[&_td]:[padding:4px_8px]!",
  "[&_td]:[height:26px]!",
  "[&_td]:[font-size:var(--text-ui-body)]!",
  "[&_th]:[padding:4px_8px]!",
  "[&_th]:[height:28px]!",
  "[&_th]:[font-size:var(--text-ui-micro)]!",
  "[&_thead_th]:[border-bottom:2px_solid_var(--color-fin-border)]!",
  "[&_td]:[text-overflow:clip]!",
].join(" ");
const OI_CHAIN_WRAP_STYLE: JSX.CSSProperties = {
  height: "auto",
  "overflow-x": "auto",
};

const OI_CHAIN_TABLE_STYLE: JSX.CSSProperties = { "min-width": 0 };

const OI_CHAIN_EXPAND_CLASS = "min-w-[22px] px-1 leading-none text-ui-micro";

export interface NiftyOiChainProps {
  strikes: NiftyStrike[];
  columns: TableColumnDef<NiftyStrike>[];
  getRowStyle: (row: NiftyStrike) => JSX.CSSProperties | undefined;
  getRowTestId: (row: NiftyStrike) => string | undefined;
  panelTestId: string;
  tableTestId: string;
  wrapTestId: string;
  wrapRef?: (el: HTMLDivElement | undefined) => void;
  onExpand?: () => void;
}

export function NiftyOiChain(props: NiftyOiChainProps) {
  const focusOf = (row: NiftyStrike): boolean => {
    const strikeColumn = props.columns.find((c) => c.id === "strike") as
      | (TableColumnDef<NiftyStrike> & { chainRowFocus?: (row: NiftyStrike) => boolean })
      | undefined;
    return strikeColumn?.chainRowFocus?.(row) ?? false;
  };
  const rowStyle = (row: NiftyStrike): JSX.CSSProperties => ({
    ...props.getRowStyle(row),
    ...(focusOf(row) ? OI_CHAIN_FOCUS_STYLE : {}),
  });
  const rowAttributes = (row: NiftyStrike) => ({
    "data-chain-focus": focusOf(row) ? "1" : undefined,
  });
  return (
    <CompactPanel
      flush
      scrollable
      title={<ReportPanelTitle>Option-chain OI (±750 ATM)</ReportPanelTitle>}
      testId={props.panelTestId}
      action={
        <Show when={props.onExpand}>
          <Button
            data-testid="nifty-oi-expand"
            size="sm"
            variant="subtle"
            aria-label="Expand the option chain"
            title="Expand the option chain"
            onClick={() => props.onExpand?.()}
            className={OI_CHAIN_EXPAND_CLASS}
          >
            ⤢
          </Button>
        </Show>
      }
      className={OI_CHAIN_PANEL_CLASS}
      style={OI_CHAIN_PANEL_STYLE}
    >
      <Box
        ref={props.wrapRef}
        data-testid={props.wrapTestId}
        data-chain-row-height={OI_CHAIN_METRICS.rowHeight}
        data-chain-value-size={OI_CHAIN_METRICS.valueSize}
        data-chain-variant={props.columns.length <= 5 ? "compact" : "full"}
        data-chain-scroll="1"
        className={OI_CHAIN_WRAP_CLASS}
        style={OI_CHAIN_WRAP_STYLE}
      >
        <TanStackTable<NiftyStrike>
          data={props.strikes}
          columns={props.columns}
          dataTestId={props.tableTestId}
          emptyMessage="No strikes for this expiry"
          fillContainer
          style={OI_CHAIN_TABLE_STYLE}
          getRowStyle={rowStyle}
          getRowAttributes={rowAttributes}
          getRowTestId={props.getRowTestId}
        />
      </Box>
    </CompactPanel>
  );
}

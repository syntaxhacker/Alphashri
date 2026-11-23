import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Badge, Box, Flex, Text } from "@/ui";
import { useValueFlash } from "@/utils/valueFlash";
import * as palette from "@/ui/palette";
import { EChart } from "../common/EChart";
import { buildPayoffMatrix, type MatrixLeg, type PayoffMatrix } from "@/utils/payoffMatrix";
import {
  buildPayoffOption,
  cellAt,
  formatExpiryLabel,
  formatSignedCompactPnl,
  INTRINSIC_ONLY_BADGE,
  INTRINSIC_ONLY_NOTE,
  payoffCellGroups,
  payoffNetGreeks,
  robustPnlDomain,
  type PayoffLeg,
  type PayoffMatrixShape,
  type PnlDomain,
} from "./payoffHeatmapOption";

export interface PayoffHeatmapProps {
  legs: PayoffLeg[];
  spot: number;
  expiries: string[];
  iv?: number | null;
  rangePct?: number;
  asOf?: string;
  selectedExpiry?: string;
  onSelectExpiry?: (expiry: string) => void;
  onSelectCell?: (strike: number, expiry: string) => void;
  height?: number;
  testIdPrefix?: string;
}

const EMPTY_MATRIX: PayoffMatrixShape = {
  strikes: [],
  expiries: [],
  cells: [],
  spotRowIndex: null,
};

const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const cellKey = (row: number, col: number) => `${row}:${col}`;

/**
 * Strike × expiry payoff heatmap. The ECharts canvas owns the paint; a
 * screen-reader-only grid mirror owns keyboard selection so the same cell can be
 * reached without a pointer and with a real roving tabindex.
 */
export function PayoffHeatmap(props: PayoffHeatmapProps) {
  const prefix = () => props.testIdPrefix ?? "payoff";
  const height = () => props.height ?? 420;
  const asOf = () => props.asOf ?? new Date().toISOString().slice(0, 10);

  const matrix = createMemo<PayoffMatrixShape>(() => {
    try {
      const built: PayoffMatrix = buildPayoffMatrix({
        legs: props.legs as MatrixLeg[],
        spot: props.spot,
        expiries: props.expiries,
        iv: props.iv,
        rangePct: props.rangePct,
        asOf: asOf(),
      });
      return built ?? EMPTY_MATRIX;
    } catch (error) {
      console.warn("PayoffHeatmap: matrix build failed", error);
      return EMPTY_MATRIX;
    }
  });

  const hasData = createMemo(() => {
    const m = matrix();
    return m.strikes.length > 0 && m.expiries.length > 0 && m.cells.length > 0;
  });

  const groups = createMemo(() => payoffCellGroups(matrix()));
  const hasUnpriced = createMemo(() => groups().unpriced.length > 0);
  const intrinsicOnly = createMemo(() =>
    groups().priced.some((cell) => cell.basis === "intrinsic-only"),
  );

  const greeks = createMemo(() => payoffNetGreeks(props.legs));

  /**
   * Colour scale anchored to defined risk. It is frozen for a leg set: dragging
   * the IV / range / spot sliders changes the numbers in the cells but never
   * recolours them, so a stray far-OTM outlier cannot wash out the whole grid.
   */
  const legSignature = () =>
    props.legs
      .map((leg) => `${leg.action}|${leg.opt}|${leg.strike}|${leg.premium}|${leg.qty}`)
      .join(";");
  let frozenLegKey = "";
  let frozenDomain: PnlDomain | null = null;
  const domain = createMemo<PnlDomain | null>(() => {
    if (!hasData()) return null;
    const key = legSignature();
    if (key !== frozenLegKey) {
      const m = matrix();
      const pnls = m.cells.flat().map((cell) => cell.pnl).filter(isNum);
      frozenDomain = robustPnlDomain(pnls, m.kpis);
      frozenLegKey = key;
    }
    return frozenDomain;
  });

  const option = createMemo(() =>
    buildPayoffOption({
      matrix: matrix(),
      legs: props.legs,
      spot: props.spot,
      iv: props.iv,
      rangePct: props.rangePct,
      asOf: asOf(),
      greeks: greeks(),
      selectedExpiry: props.selectedExpiry,
      domain: domain(),
    }),
  );

  /** Axis rows are descending; the matrix rows arrive ascending. */
  const spotAxisRow = createMemo(() => {
    const m = matrix();
    if (m.strikes.length === 0) return 0;
    const row = m.spotRowIndex;
    return isNum(row) ? Math.max(0, Math.min(m.strikes.length - 1, m.strikes.length - 1 - row)) : Math.round((m.strikes.length - 1) / 2);
  });

  /** Mirror rows in the same descending order as the painted strike axis. */
  const mirrorStrikes = createMemo(() => [...matrix().strikes].sort((a, b) => b - a));

  const [moved, setMoved] = createSignal(false);
  const [rawCursor, setRawCursor] = createSignal({ row: 0, col: 0 });
  const cursor = createMemo(() => {
    const m = matrix();
    const raw = rawCursor();
    if (!moved()) return { row: spotAxisRow(), col: 0 };
    return {
      row: Math.max(0, Math.min(Math.max(0, m.strikes.length - 1), raw.row)),
      col: Math.max(0, Math.min(Math.max(0, m.expiries.length - 1), raw.col)),
    };
  });

  const cellForCursor = createMemo(() => {
    const m = matrix();
    const at = cursor();
    if (m.strikes.length === 0 || m.expiries.length === 0) return null;
    const sourceRow = m.strikes.length - 1 - at.row;
    const strike = m.strikes[sourceRow];
    const expiry = m.expiries[at.col];
    return { strike, expiry, cell: cellAt(m, sourceRow, at.col) };
  });

  const selectCurrent = () => {
    const current = cellForCursor();
    if (!current) return;
    props.onSelectCell?.(current.strike, current.expiry);
    props.onSelectExpiry?.(current.expiry);
  };

  const setCursorAt = (row: number, col: number) => {
    setMoved(true);
    setRawCursor({ row, col });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!hasData()) return;
    const at = cursor();
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setCursorAt(at.row, at.col - 1),
      ArrowRight: () => setCursorAt(at.row, at.col + 1),
      ArrowUp: () => setCursorAt(at.row - 1, at.col),
      ArrowDown: () => setCursorAt(at.row + 1, at.col),
      Enter: selectCurrent,
      " ": selectCurrent,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const cellRefs = new Map<string, HTMLElement>();
  createEffect(() => {
    const at = cursor();
    if (!hasData() || !moved()) return;
    cellRefs.get(cellKey(at.row, at.col))?.focus();
  });

  const handleClick = (raw: unknown) => {
    const params = (Array.isArray(raw) ? raw[0] : raw) as
      | { componentType?: string; value?: unknown; data?: Record<string, unknown> }
      | undefined;
    if (!params) return;
    if (params.componentType === "xAxis") {
      const index = Number(params.value);
      const expiry = matrix().expiries[index];
      if (expiry) props.onSelectExpiry?.(expiry);
      return;
    }
    const data = params.data;
    if (!data) return;
    const value = Array.isArray(data.value) ? data.value : [];
    const x = Number(value[0]);
    const y = Number(value[1]);
    const strike = isNum(data.strike) ? data.strike : matrix().strikes[matrix().strikes.length - 1 - y];
    const expiry = typeof data.expiry === "string" ? data.expiry : matrix().expiries[x];
    if (!isNum(strike) || !expiry) return;
    props.onSelectCell?.(strike, expiry);
  };

  const events = { click: handleClick };

  return (
    <Box
      data-testid={prefix() + "-heatmap"}
      className="relative flex min-h-0 flex-col"
      style={{ height: `${height()}px`, "min-height": `${height()}px` }}
    >
      <Flex
        data-testid={prefix() + "-legend"}
        className="shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-fin-border px-2 py-1"
      >
        <LegendSwatch label="LOSS" color={palette.NEGATIVE} testId={prefix() + "-legend-loss"} />
        <LegendSwatch
          label="FLAT"
          color={palette.alpha(palette.NEUTRAL, 0.16)}
          testId={prefix() + "-legend-flat"}
        />
        <LegendSwatch label="PROFIT" color={palette.POSITIVE} testId={prefix() + "-legend-profit"} />
        <Show when={hasUnpriced()}>
          <LegendSwatch
            label="NOIV"
            color={palette.SURFACE_ALT}
            hatched
            testId={prefix() + "-legend-no-iv"}
          />
        </Show>
        <LegendSwatch label="SPOT" color={palette.INFO} line testId={prefix() + "-legend-spot"} />
        <LegendSwatch label="LEGS" color={palette.PRIMARY} line testId={prefix() + "-legend-legs"} />
        <Show when={intrinsicOnly()}>
          <Badge
            color="warning"
            variant="outline"
            size="sm"
            data-testid={prefix() + "-intrinsic-only-badge"}
            title={INTRINSIC_ONLY_NOTE}
          >
            {INTRINSIC_ONLY_BADGE}
          </Badge>
        </Show>
      </Flex>

      <Box className="relative min-h-0 flex-1">
        <Show
          when={hasData()}
          fallback={
            <Flex
              data-testid={prefix() + "-heatmap-empty"}
              className="h-full w-full items-center justify-center"
            >
              <Text size="sm" c="dimmed">
                No payoff data — add a leg to see the grid
              </Text>
            </Flex>
          }
        >
          <EChart
            option={option()}
            onEvents={events}
            data-testid={prefix() + "-heatmap-chart"}
            style={{ flex: "none", height: "100%", "min-height": "0px", width: "100%" }}
          />
          <div
            data-testid={`${prefix()}-heatmap-flash-layer`}
            aria-hidden="true"
            className="pointer-events-none absolute z-[1]"
            style={{
              inset: "20px 10px 26px 34px",
              display: "grid",
              "grid-template-columns": `repeat(${matrix().expiries.length}, minmax(0, 1fr))`,
              "grid-template-rows": `repeat(${matrix().strikes.length}, minmax(0, 1fr))`,
            }}
          >
            <For each={mirrorStrikes()}>
              {(_strike, row) => (
                <For each={matrix().expiries}>
                  {(_expiry, col) => {
                    const pnl = () => {
                      const m = matrix();
                      return cellAt(m, m.strikes.length - 1 - row(), col())?.pnl ?? null;
                    };
                    const flash = useValueFlash(pnl);
                    return (
                      <Show when={flash.key() > 0 ? flash.key() : undefined} keyed>
                        {(key) => (
                          <div
                            className={flash.className()}
                            data-flash-key={key}
                            data-testid={`${prefix()}-heatmap-flash-${row()}-${col()}`}
                          />
                        )}
                      </Show>
                    );
                  }}
                </For>
              )}
            </For>
          </div>
          <Box
            tabIndex={0}
            role="grid"
            aria-label="Payoff heatmap. Use arrow keys to move between cells and Enter to select."
            data-testid={prefix() + "-heatmap-keyboard"}
            className="absolute inset-0 outline-none focus-visible:outline focus-visible:outline-1"
            style={{ "pointer-events": "none" }}
            onKeyDown={onKeyDown}
          >
            <For each={mirrorStrikes()}>
              {(strike, row) => (
                <Box role="row" className="sr-only">
                  <For each={matrix().expiries}>
                    {(expiry, col) => {
                      const active = () => cursor().row === row() && cursor().col === col();
                      const key = () => cellKey(row(), col());
                      const pnl = () => {
                        const m = matrix();
                        const sourceRow = m.strikes.length - 1 - row();
                        return cellAt(m, sourceRow, col())?.pnl ?? null;
                      };
                      const flash = useValueFlash(pnl);
                      return (
                        <Box
                          role="gridcell"
                          aria-selected={active()}
                          aria-label={`₹${strike} ${formatExpiryLabel(expiry, asOf())} ${formatSignedCompactPnl(cellAt(matrix(), matrix().strikes.length - 1 - row(), col())?.pnl)}`}
                          tabIndex={active() ? 0 : -1}
                          data-testid={`${prefix()}-heatmap-cell-${row()}-${col()}`}
                          data-strike={strike}
                          data-expiry={expiry}
                          data-flash-key={flash.key()}
                          data-flash-direction={flash.direction()}
                          className={flash.className()}
                          ref={(node: HTMLElement) => { cellRefs.set(key(), node); }}
                        />
                      );
                    }}
                  </For>
                </Box>
              )}
            </For>
            <span aria-live="polite" class="sr-only" data-testid={prefix() + "-heatmap-cursor"}>
              {(() => {
                const current = cellForCursor();
                return current
                  ? `${current.strike} ${formatExpiryLabel(current.expiry, asOf())} ${formatSignedCompactPnl(current.cell?.pnl)}`
                  : "";
              })()}
            </span>
          </Box>
        </Show>
      </Box>
    </Box>
  );
}

function LegendSwatch(props: {
  label: string;
  color: string;
  line?: boolean;
  hatched?: boolean;
  testId: string;
}) {
  const hatch = `repeating-linear-gradient(45deg, ${palette.alpha(palette.TEXT_MUTED, 0.7)} 0, ${palette.alpha(palette.TEXT_MUTED, 0.7)} 1px, transparent 1px, transparent 3px)`;
  return (
    <Flex className="items-center gap-1" data-testid={props.testId}>
      <Box
        className={props.line ? "h-0.5 w-3" : "h-2 w-2"}
        style={props.hatched
          ? { "background-color": props.color, "background-image": hatch }
          : { "background-color": props.color }}
      />
      <Text
        size="xs"
        c="dimmed"
        className="uppercase"
        style={{ "font-size": "9px", "letter-spacing": "0.06em" }}
      >
        {props.label}
      </Text>
    </Flex>
  );
}

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  getOwner,
  runWithOwner,
  Show,
  type JSX,
  type Setter,
} from "solid-js";
import { Box, Flex, Slider } from "@/ui";
import { useValueFlash, type ValueFlash } from "@/utils/valueFlash";
import * as palette from "@/ui/palette";
import { TanStackTable } from "../common/TanStackTable";
import {
  buildCellTooltip,
  buildTable,
  cellFill,
  EMPTY_TABLE,
  formatCellPnl,
  formatSpotPct,
  formatStrike,
  INTRINSIC_ONLY_NOTE,
  ivToPercent,
  nearbyLegs,
  PAYOFF_VIEWS,
  rangeToPercent,
  robustDomain,
  toRows,
  unpricedFill,
  UNPRICED_NOTE,
  type PayoffRow,
  type PayoffTable as PayoffTableShape,
  type PayoffTableCell,
  type PayoffTableLeg,
  type PayoffViewId,
} from "./payoffTableOption";
import { payoffColumns } from "./PayoffTable.columns";

export interface PayoffTableProps {
  legs: PayoffTableLeg[];
  spot: number;
  iv?: number | null;
  rangePct?: number;
  asOf?: string;
  onSelectCell?: (strike: number, expiry: string) => void;
  onRangeChange?: (pct: number) => void;
  onViewChange?: (view: string) => void;
  height?: number;
  testIdPrefix?: string;
}

/** A hatch over the raised surface marks a cell that genuinely has no P&L. */
const HATCH = `repeating-linear-gradient(45deg, ${palette.alpha(palette.TEXT_MUTED, 0.7)} 0, ${palette.alpha(palette.TEXT_MUTED, 0.7)} 1px, transparent 1px, transparent 4px)`;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function PayoffTable(props: PayoffTableProps) {
  const prefix = () => props.testIdPrefix ?? "payoff";
  const height = () => props.height ?? 440;
  const asOf = () => props.asOf ?? new Date().toISOString().slice(0, 10);
  const legs = (): PayoffTableLeg[] => props.legs ?? [];

  const [rangePercent, setRangePercent] = createSignal(rangeToPercent(props.rangePct));
  const [ivPercent, setIvPercent] = createSignal(ivToPercent(props.iv));
  const [activeView, setActiveView] = createSignal<PayoffViewId>("table");

  const table = createMemo<PayoffTableShape>(() =>
    buildTable({
      legs: legs(),
      spot: props.spot,
      iv: ivPercent() > 0 ? ivPercent() / 100 : null,
      rangePct: rangePercent() / 100,
      asOf: asOf(),
    }) ?? EMPTY_TABLE,
  );
  const rows = createMemo(() => toRows(table()));
  const hasData = createMemo(() => rows().length > 0 && table().expiries.length > 0);
  const domain = createMemo(() =>
    robustDomain(table().cells ?? [], (table().kpis ?? {}) as PayoffTableShape["kpis"]),
  );

  // Roving tabindex. The initial stop is the ATM strike (or the first row) so a
  // keyboard user lands on the most meaningful cell without a pointer.
  const [rawCursor, setRawCursor] = createSignal({ row: 0, col: 0 });
  const [moved, setMoved] = createSignal(false);
  const cellRefs = new Map<string, HTMLElement>();
  const defaultRow = createMemo(() => {
    const all = rows();
    const atm = all.findIndex((row) => row.isAtm);
    return atm >= 0 ? atm : 0;
  });
  const cursor = createMemo(() => {
    const all = rows();
    const colCount = table().expiries.length;
    const raw = rawCursor();
    if (!moved()) return { row: Math.min(defaultRow(), Math.max(0, all.length - 1)), col: 0 };
    return {
      row: Math.min(Math.max(0, raw.row), Math.max(0, all.length - 1)),
      col: Math.min(Math.max(0, raw.col), Math.max(0, colCount - 1)),
    };
  });

  createEffect(() => {
    const at = cursor();
    if (!moved() || !hasData()) return;
    cellRefs.get(`${at.row}:${at.col}`)?.focus();
  });

  const selectCell = (rowIndex: number, colIndex: number) => {
    const row = rows()[rowIndex];
    const expiry = table().expiries[colIndex];
    if (!row || !expiry) return;
    props.onSelectCell?.(row.strike, expiry.date);
  };

  const onCellKeyDown = (event: KeyboardEvent, rowIndex: number, colIndex: number) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => setCursor(rowIndex, colIndex - 1),
      ArrowRight: () => setCursor(rowIndex, colIndex + 1),
      ArrowUp: () => setCursor(rowIndex - 1, colIndex),
      ArrowDown: () => setCursor(rowIndex + 1, colIndex),
      Enter: () => selectCell(rowIndex, colIndex),
      " ": () => selectCell(rowIndex, colIndex),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const setCursor = (rowIndex: number, colIndex: number) => {
    setMoved(true);
    setRawCursor({
      row: Math.max(0, Math.min(rowIndex, rows().length - 1)),
      col: Math.max(0, Math.min(colIndex, table().expiries.length - 1)),
    });
  };

  // A TanStack cell render re-runs on every data tick, so the flash hook must be
  // owned by the component (not the short-lived cell effect) to keep its
  // previous-value baseline and sequence across renders.
  interface CellFlash {
    setValue: Setter<number | null | undefined>;
    flash: ValueFlash;
  }
  const flashOwner = getOwner();
  const cellFlashes = new Map<string, CellFlash>();
  const cellFlashFor = (key: string, pnl: number | null | undefined): ValueFlash => {
    const existing = cellFlashes.get(key);
    if (existing) {
      existing.setValue(pnl);
      return existing.flash;
    }
    const [value, setValue] = createSignal<number | null | undefined>(pnl);
    const make = () => useValueFlash(value);
    const flash = flashOwner ? runWithOwner(flashOwner, make)! : make();
    const entry: CellFlash = { setValue, flash };
    cellFlashes.set(key, entry);
    return flash;
  };

  const renderStrikeCell = (row: PayoffRow, rowIndex: number): JSX.Element => {
    const tags = nearbyLegs(legs(), row.strike);
    return (
      <div
        className="flex h-full flex-col justify-center gap-0"
        data-testid={`${prefix()}-strike-${rowIndex}`}
        style={{
          "border-left": row.isAtm
            ? `2px dashed ${palette.PRIMARY}`
            : "2px solid transparent",
          "padding-left": "6px",
        }}
      >
        <span
          className="font-mono tabular-nums"
          style={{ "font-size": "11px", color: row.isAtm ? palette.PRIMARY : palette.TEXT, "line-height": "1.2" }}
        >
          {formatStrike(row.strike)}
        </span>
        <span
          className="font-mono tabular-nums"
          style={{ "font-size": "9px", color: palette.TEXT_MUTED, "line-height": "1.2" }}
        >
          {formatSpotPct(row.spotPct)}
        </span>
        <Show when={tags.length > 0}>
          <span className="flex flex-wrap gap-1" data-testid={`${prefix()}-leg-tags-${rowIndex}`}>
            <For each={tags}>
              {(leg, tagIndex) => (
                <span
                  data-testid={`${prefix()}-leg-tag-${rowIndex}-${tagIndex()}`}
                  className="font-mono uppercase"
                  style={{
                    "font-size": "9px",
                    color: leg.action === "BUY" ? palette.POSITIVE : palette.NEGATIVE,
                    "letter-spacing": "0.04em",
                  }}
                >
                  {leg.action} {leg.opt}
                </span>
              )}
            </For>
          </span>
        </Show>
      </div>
    );
  };

  const renderPnlCell = (
    row: PayoffRow,
    rowIndex: number,
    colIndex: number,
  ): JSX.Element => {
    const expiry = table().expiries[colIndex];
    const cell = (): PayoffTableCell | null => row.cells[colIndex] ?? null;
    const priced = () => {
      const value = cell();
      return !!value && value.priced !== false && isFiniteNumber(value.pnl);
    };
    const fill = () => (priced() ? cellFill(cell()!.pnl, domain()) : unpricedFill());
    const tooltip = () =>
      buildCellTooltip({ strike: row.strike, spotPct: row.spotPct, expiry, cell: cell(), legs: legs() });
    const active = () => cursor().row === rowIndex && cursor().col === colIndex;
    const hatchStyle = () =>
      priced()
        ? { background: fill()!.background }
        : { background: fill()!.background, "background-image": HATCH };
    const inkColor = () => fill()!.ink;
    const flash = cellFlashFor(`${rowIndex}:${colIndex}`, priced() ? cell()!.pnl : null);

    return (
      <>
        <div className="payoff-cell-fill" aria-hidden="true" style={hatchStyle()} />
        <Show when={flash.key() > 0 ? flash.key() : undefined} keyed>
          {(key) => (
            <div
              aria-hidden="true"
              className={`payoff-cell-flash ${flash.className()}`}
              data-flash-key={key}
              data-flash-direction={flash.direction()}
              data-testid={`${prefix()}-cell-flash-${rowIndex}-${colIndex}`}
            />
          )}
        </Show>
        <div
          role="gridcell"
          aria-selected={active()}
          aria-label={tooltip()}
          title={tooltip()}
          data-testid={`${prefix()}-cell-${rowIndex}-${colIndex}`}
          data-strike={row.strike}
          data-expiry={expiry?.date}
          data-priced={priced() ? "true" : "false"}
          data-basis={cell()?.basis ?? "unpriced"}
          data-flash-key={flash.key()}
          data-flash-direction={flash.direction()}
          tabIndex={active() ? 0 : -1}
          className={`payoff-cell-gridcell font-mono tabular-nums ${flash.className()}`}
          style={{ color: inkColor(), "font-size": "11px", "justify-content": "flex-end" }}
          ref={(node: HTMLElement) => { cellRefs.set(`${rowIndex}:${colIndex}`, node); }}
          onClick={() => selectCell(rowIndex, colIndex)}
          onKeyDown={(event: KeyboardEvent) => onCellKeyDown(event, rowIndex, colIndex)}
        >
          {priced() ? formatCellPnl(cell()!.pnl) : "—"}
        </div>
      </>
    );
  };

  const columns = () => payoffColumns({
    expiries: table().expiries,
    prefix: prefix(),
    renderStrikeCell,
    renderPnlCell,
  });

  const tableTestId = () => `${prefix()}-table`;
  const stickyCss = () => `
    /* Explicit dense rhythm: the shared dense preset is 18px/10px, too small
       for a numeric lattice. An important rule wins over the inline vars the
       table writes, so the opt-in can stay without drifting these numbers. */
    [data-testid="${tableTestId()}"] {
      --tbl-cell-pad: 8px 12px !important;
      --tbl-fs: 11px !important;
      --tbl-row-h: 27px !important;
    }
    [data-testid="${tableTestId()}"] tbody td { position: relative; }
    [data-testid="${tableTestId()}"] thead th:first-child,
    [data-testid="${tableTestId()}"] tbody tr td:first-child {
      position: sticky !important; left: 0 !important; z-index: 2;
      background-color: var(--color-fin-surface) !important;
    }
    [data-testid="${tableTestId()}"] .payoff-cell-fill {
      position: absolute; inset: 0; box-sizing: border-box;
    }
    /* Brief tint over the gradient fill; the gridcell (z-index 1) keeps its
       contrast-safe text above it. */
    [data-testid="${tableTestId()}"] .payoff-cell-flash {
      position: absolute; inset: 0; box-sizing: border-box; pointer-events: none;
    }
    [data-testid="${tableTestId()}"] .payoff-cell-gridcell {
      position: relative; z-index: 1; box-sizing: border-box;
      display: flex; align-items: center; width: 100%; min-height: 24px;
      outline-offset: -2px;
    }
  `;

  const setView = (id: PayoffViewId) => {
    setActiveView(id);
    props.onViewChange?.(id);
  };

  const kpis = () => table().kpis ?? {};

  return (
    <Box
      data-testid={`${prefix()}-table-panel`}
      className="flex min-h-0 flex-col overflow-hidden border border-fin-border bg-fin-surface"
      style={{ height: `${height()}px`, "min-height": `${height()}px` }}
    >
      <style>{stickyCss()}</style>

      <Flex
        data-testid={`${prefix()}-controls`}
        className="shrink-0 items-center gap-4 border-b border-fin-border px-2 py-1"
      >
        <Box className="w-[180px] shrink-0">
          <Slider
            testId={`${prefix()}-table-range`}
            label="RANGE ±%"
            min={1}
            max={30}
            step={1}
            value={rangePercent()}
            formatValue={(value) => `${value}%`}
            onChange={(value) => {
              setRangePercent(value);
              props.onRangeChange?.(value / 100);
            }}
          />
        </Box>
        <Box className="w-[180px] shrink-0">
          <Slider
            testId={`${prefix()}-table-iv`}
            label="IV"
            min={0}
            max={100}
            step={1}
            value={ivPercent()}
            formatValue={(value) => (value === 0 ? "— intrinsic" : `${value}%`)}
            onChange={(value) => setIvPercent(value)}
          />
        </Box>
      </Flex>

      <Flex
        data-testid={`${prefix()}-strikes-label`}
        className="h-[22px] shrink-0 items-center justify-between border-b border-fin-border px-2"
      >
        <span
          className="font-mono uppercase"
          style={{ "font-size": "9px", color: palette.PRIMARY, "letter-spacing": "0.08em" }}
        >
          STRIKES
        </span>
        <span className="font-mono tabular-nums" style={{ "font-size": "9px", color: palette.TEXT_MUTED }}>
          {rows().length} × {table().expiries.length}
        </span>
      </Flex>

      <Box className="relative min-h-0 flex-1">
        <Show
          when={hasData()}
          fallback={
            <Flex
              data-testid={`${prefix()}-table-empty`}
              className="h-full w-full items-center justify-center"
            >
              <span className="font-mono" style={{ "font-size": "11px", color: palette.TEXT_MUTED }}>
                No payoff data — add a leg to build the table
              </span>
            </Flex>
          }
        >
          <TanStackTable<PayoffRow>
            data={rows()}
            columns={columns()}
            dataTestId={tableTestId()}
            ariaLabel="Strike by expiry payoff table"
            stickyHeader
            dense
            enableSorting={false}
            fillContainer
            minTableWidth={Math.max(640, 116 + table().expiries.length * 92)}
            getRowClassName={(row) => (row.isAtm ? `${prefix()}-atm-row` : undefined)}
            getRowTestId={(row) => `${prefix()}-row-${row.strike}`}
            getRowStyle={() => ({ height: "27px", "vertical-align": "middle" })}
          />
        </Show>
      </Box>

      <Flex
        data-testid={`${prefix()}-kpis`}
        className="h-[26px] shrink-0 items-center gap-3 border-t border-fin-border px-2 font-mono tabular-nums"
        style={{ "font-size": "9px", color: palette.TEXT_MUTED }}
      >
        <span data-testid={`${prefix()}-kpi-debit`}>NET {formatCellPnl(kpis().netDebit)}</span>
        <span data-testid={`${prefix()}-kpi-max-profit`}>MAX {formatCellPnl(kpis().maxProfit)}</span>
        <span data-testid={`${prefix()}-kpi-max-loss`}>RISK {formatCellPnl(kpis().maxLoss)}</span>
        <span data-testid={`${prefix()}-kpi-pop`}>
          POP {isFiniteNumber(kpis().pop) ? `${Math.round((kpis().pop as number) * 100)}%` : "—"}
        </span>
      </Flex>

      <Flex
        data-testid={`${prefix()}-view-tabs`}
        className="h-[34px] shrink-0 items-stretch border-t border-fin-border"
      >
        <For each={PAYOFF_VIEWS}>
          {(view) => (
            <button
              type="button"
              data-testid={`${prefix()}-view-tab-${view.id}`}
              aria-pressed={activeView() === view.id}
              className="flex-1 whitespace-nowrap px-1 font-mono"
              style={{
                "font-size": "9px",
                color: activeView() === view.id ? palette.PRIMARY : palette.TEXT_MUTED,
                "border-bottom": `2px solid ${activeView() === view.id ? palette.PRIMARY : "transparent"}`,
                background: "transparent",
                cursor: "pointer",
              }}
              onClick={() => setView(view.id)}
            >
              {view.label}
            </button>
          )}
        </For>
      </Flex>

      <span className="sr-only" aria-live="polite" data-testid={`${prefix()}-cursor`}>
        {(() => {
          const at = cursor();
          const row = rows()[at.row];
          const expiry = table().expiries[at.col];
          if (!row || !expiry) return "";
          const cell = row.cells[at.col];
          return `${formatStrike(row.strike)} ${expiry.label} ${formatCellPnl(cell?.pnl ?? null)}`;
        })()}
      </span>

      <Show when={table().cells.flat().some((cell) => cell?.basis === "intrinsic-only")}>
        <span className="sr-only" data-testid={`${prefix()}-intrinsic-note`}>{INTRINSIC_ONLY_NOTE}</span>
      </Show>
      <Show when={table().cells.flat().some((cell) => !cell?.priced)}>
        <span className="sr-only" data-testid={`${prefix()}-unpriced-note`}>{UNPRICED_NOTE}</span>
      </Show>
    </Box>
  );
}

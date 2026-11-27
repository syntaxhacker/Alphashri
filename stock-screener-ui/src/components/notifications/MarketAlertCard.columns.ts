/** Column geometry for the alert log. Kept out of the component so the table
 * structure guard sees one canonical home for column declarations. */

export const LOG_COLUMNS = ["", "KIND", "SEV", "SYMBOL", "HEADLINE", "FACTS", "IST"] as const;

/** Below this width the fixed terminal columns starve HEADLINE of all space. */
export const LOG_NARROW_BREAKPOINT = 640;
const LOG_RAIL = 2;
const LOG_GAP = 4;
const LOG_CHROME = 6;

export interface LogLayout {
  /** 0 = the KIND column is dropped so TYPE can keep a readable headline. */
  kind: number;
  sev: number;
  symbol: number;
  facts: number;
  ist: number;
  dismiss: number;
  headlineMin: number;
}

export const LOG_LAYOUT_WIDE: LogLayout = {
  kind: 34,
  sev: 70,
  symbol: 92,
  facts: 232,
  ist: 34,
  dismiss: 18,
  headlineMin: 0,
};

const LOG_LAYOUT_NARROW: LogLayout = {
  kind: 0,
  sev: 64,
  symbol: 70,
  facts: 96,
  ist: 34,
  dismiss: 18,
  headlineMin: 48,
};

export function logLayoutFor(width: number): LogLayout {
  return width > 0 && width <= LOG_NARROW_BREAKPOINT ? LOG_LAYOUT_NARROW : LOG_LAYOUT_WIDE;
}

/** Every column except HEADLINE, plus the gaps between the flex children. */
export function logFixedWidth(layout: LogLayout): number {
  const fixedColumns = [
    LOG_RAIL,
    layout.kind,
    layout.sev,
    layout.symbol,
    layout.facts,
    layout.ist,
    layout.dismiss,
  ].filter((w) => w > 0);
  return fixedColumns.reduce(
    (sum, w) => sum + w,
    fixedColumns.length * LOG_GAP + LOG_CHROME,
  );
}

/** HEADLINE keeps at least its minimum when the layout is used at `width`. */
export function logLayoutFits(width: number, layout = logLayoutFor(width)): boolean {
  return logFixedWidth(layout) + layout.headlineMin <= width;
}

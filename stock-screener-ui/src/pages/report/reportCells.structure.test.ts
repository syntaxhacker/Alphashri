// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "reportCells.tsx";
const LINE_BUDGET = 450;

const MODULES: Record<string, string> = {
  "reportCells.format.ts": "export function formatSignedPoints",
  "reportCells.decision.tsx": "export function DecisionCell",
  "reportCells.chainMetrics.ts": "export const OI_CHAIN_METRICS",
  "reportCells.chainCells.tsx": "export function sentimentBadge",
  "reportCells.chainColumns.tsx": "export function getNiftyOiColumns",
  "reportCells.chainPanel.tsx": "export function NiftyOiChain",
};

const MODULE_NAMES = Object.keys(MODULES);

describe("reportCells decomposition", () => {
  test("every section stays under the line budget", () => {
    for (const file of [FACADE, ...MODULE_NAMES]) {
      expect(lines(file), `${file} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps every stable public export", () => {
    const facade = source(FACADE);
    expect(facade).toContain('export { replayFromMeta } from "./niftyReplay"');
    for (const module of MODULE_NAMES) {
      expect(facade, `facade no longer re-exports ${module}`).toContain(
        `export * from "./${module.replace(/\.(ts|tsx)$/, "")}";`,
      );
    }
  });

  test("each module keeps its stated responsibility", () => {
    for (const [module, snippet] of Object.entries(MODULES)) {
      expect(source(module), `${module} lost its responsibility`).toContain(snippet);
    }
  });

  test("facade delegates instead of re-inlining a section", () => {
    const facade = source(FACADE);
    for (const inlined of [
      "export function DecisionCell",
      "export function getNiftyOiColumns",
      "export function NiftyOiChain",
      "data-testid=",
      "OI_CHAIN_METRICS",
      "Cr/pt",
    ]) {
      expect(facade, `facade re-inlined ${inlined}`).not.toContain(inlined);
    }
  });

  test("every testid, data attribute, unit and copy token survives the split", () => {
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    for (const token of [
      'data-testid={`${props.testId}-value`}',
      'data-testid={`nifty-oi-signal-${side}`}',
      '"nifty-wall-cw"',
      '"nifty-wall-pw"',
      '"nifty-wall-cw-below"',
      '"nifty-wall-pw-above"',
      "data-testid={barTestId}",
      '"nifty-oi-bar-ce"',
      '"nifty-oi-bar-pe"',
      '"nifty-strike-atm-badge"',
      'data-testid="nifty-oi-expand"',
      '"data-chain-focus": focusOf(row) ? "1" : undefined,',
      'data-chain-focus-text={focused ? "1" : undefined}',
      'data-chain-row-height={OI_CHAIN_METRICS.rowHeight}',
      'data-chain-value-size={OI_CHAIN_METRICS.valueSize}',
      'data-chain-variant={props.columns.length <= 5 ? "compact" : "full"}',
      'data-chain-scroll="1"',
      "data-pct={Math.round(pct)}",
      " pts`",
      " Cr`",
      " L`",
      ' Cr/pt`',
      '"Strike price (₹)"',
      '"points (LTP − prev close)"',
      "since the previous snapshot",
      "Option-chain OI (±750 ATM)",
      '"No strikes for this expiry"',
      '"PCR-OI n/a — chain incomplete"',
      '"Dealers LONG gamma — moves dampened"',
      "`⏳ SETUP ARMING",
      "`FLOW FLIP ·",
    ]) {
      expect(all, `lost contract: ${token}`).toContain(token);
    }
  });

  test("the 12px label / 13px value hierarchy stays token-driven", () => {
    const metrics = source("reportCells.chainMetrics.ts");
    expect(metrics).toContain("labelSize: REPORT_FONT.micro");
    expect(metrics).toContain("valueSize: REPORT_FONT.body");
    expect(metrics).toContain("rowHeight: REPORT_ROW.walls");
    const cells = source("reportCells.chainCells.tsx");
    expect(cells).toContain('"font-size": `${REPORT_FONT.micro}px`');
    expect(cells).toContain('"font-size": `${OI_CHAIN_METRICS.valueSize}px`');
    expect(source("reportCells.chainColumns.tsx")).toContain(
      '"font-size": `${OI_CHAIN_METRICS.valueSize}px`',
    );
    expect(source("reportCells.chainPanel.tsx")).toContain(
      "[&_td]:[font-size:var(--text-ui-body)]!",
    );
    expect(source("reportCells.chainPanel.tsx")).toContain(
      "[&_th]:[font-size:var(--text-ui-micro)]!",
    );
  });

  test("the desk chain still fits 384px inside the 420px panel", () => {
    const metrics = source("reportCells.chainMetrics.ts");
    const width = (name: string) =>
      Number(metrics.match(new RegExp(`export const ${name} = (\\d+);`))?.[1]);
    const desk = width("OI_DESK_OI_W") * 2 + width("OI_DESK_SIG_W") * 2 + width("OI_DESK_STRIKE_W");
    expect(desk).toBe(384);
    expect(desk).toBeLessThan(width("OI_CHAIN_PANEL_BUDGET") - 16);
    expect(metrics).toContain(
      "OI_DESK_OI_W * 2 + OI_DESK_SIG_W * 2 + OI_DESK_STRIKE_W",
    );
    expect(source("reportCells.chainColumns.tsx")).toContain("opts?.showLegChange === false");
    expect(source("reportCells.chainPanel.tsx")).toContain(
      'props.columns.length <= 5 ? "compact" : "full"',
    );
  });

  test("ATM/wall row emphasis survives the split", () => {
    const columns = source("reportCells.chainColumns.tsx");
    const panel = source("reportCells.chainPanel.tsx");
    const cells = source("reportCells.chainCells.tsx");
    expect(columns).toContain("chainRowFocus: rowFocus");
    expect(panel).toContain("strikeColumn?.chainRowFocus?.(row)");
    expect(panel).toContain("OI_CHAIN_FOCUS_STYLE");
    expect(panel).toContain("inset 3px 0 0 ${palette.TERM_FLIP}");
    expect(columns).toContain("REPORT_FONT_WEIGHT.extrabold");
    expect(cells).toContain("emphasis ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.bold");
    expect(cells).toContain("opacity: emphasis ? 1 : 0.92");
  });
});

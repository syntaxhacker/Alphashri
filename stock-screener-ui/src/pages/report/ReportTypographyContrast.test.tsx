// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { UIProvider } from "@/ui";
import {
  BG,
  BORDER,
  PRIMARY,
  SURFACE,
  TEXT,
  TEXT_MUTED,
} from "@/ui/palette";
import { contrastRatio, parseColor, pickTextColor } from "@/utils/contrast";
import { REPORT_FONT } from "./reportTokens";
import { DeskDock } from "./DeskDock";
import type { DeskDockTab } from "./DeskDock";
import { NiftyCoilGauge } from "./NiftyCoilGauge";
import type { NiftyRegimeBlock } from "@/types/niftyReport";

const HERE = join(process.cwd(), "src/pages/report");
const FLOOR = 11;
const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

/** The Index Report typography lane's owned files. */
const TYPOGRAPHY_FILES = [
  "NiftyOiHeatmap.tsx",
  "NiftyVerdictStrip.tsx",
  "ReportDecisionStrip.tsx",
  "IndexMoversStrip.tsx",
  "NiftyCoilGauge.tsx",
  "DeskDock.tsx",
  "reportCells.tsx",
  "reportTokens.ts",
] as const;

const FONT_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|font-size="(\d+(?:\.\d+)?)"|fontSize:\s*(\d+(?:\.\d+)?)\b/g;

function source(file: string): string {
  return readFileSync(join(HERE, file), "utf8");
}

function literalSizes(): Array<{ file: string; line: number; px: number }> {
  return TYPOGRAPHY_FILES.flatMap((file) => {
    const out: Array<{ file: string; line: number; px: number }> = [];
    source(file)
      .split("\n")
      .forEach((line, i) => {
        for (const match of line.matchAll(FONT_SIZE)) {
          out.push({
            file,
            line: i + 1,
            px: Number(match[1] ?? match[2] ?? match[3] ?? match[4]),
          });
        }
      });
    return out;
  });
}

/** Tailwind `fin-*` utility → the palette token behind the CSS variable. */
const FIN_TOKEN: Record<string, string> = {
  "fin-bg": BG,
  "fin-surface": SURFACE,
  "fin-border": BORDER,
  "fin-text": TEXT,
  "fin-text-muted": TEXT_MUTED,
  "fin-primary": PRIMARY,
};

afterEach(cleanup);

describe("Index Report typography floor — owned files", () => {
  test("(a) no font-size below 11px in any owned file", () => {
    const offenders = literalSizes().filter(({ px }) => px < FLOOR);
    expect(
      offenders.map(({ file, line, px }) => `${file}:${line} = ${px}px`),
      "\n" + offenders.map(({ file, line, px }) => `${file}:${line} = ${px}px`).join("\n"),
    ).toEqual([]);
  });

  test("(e) the type scale uses at most four distinct sizes", () => {
    const tokens = Object.entries(REPORT_FONT)
      .filter(([, value]) => typeof value === "number")
      .map(([, value]) => value as number);
    const sizes = new Set([...tokens, ...literalSizes().map(({ px }) => px)]);
    expect([...sizes].sort((a, b) => a - b)).toEqual([11, 12, 15, 16]);
    expect(sizes.size).toBeLessThanOrEqual(4);
  });
});

describe("Index Report contrast regressions — report strips", () => {
  const expandMarkup = () => {
    const lines = source("IndexMoversStrip.tsx").split("\n");
    const at = lines.findIndex((line) => line.includes('data-testid="movers-expand"'));
    return at < 0 ? "" : lines.slice(at, at + 4).join(" ");
  };

  test("(b) the MOVERS EXPAND button ink and border meet AA on the strip", () => {
    const line = expandMarkup();
    expect(line, "EXPAND button markup must exist").not.toBe("");

    const textClass = /text-(fin-[\w-]+)/.exec(line)?.[1] ?? "";
    const borderClass = /border-(fin-[\w-]+)/.exec(line)?.[1] ?? "";
    const ink = FIN_TOKEN[textClass];
    const border = FIN_TOKEN[borderClass];
    expect(ink, `unmapped text class ${textClass}`).toBeDefined();
    expect(border, `unmapped border class ${borderClass}`).toBeDefined();

    // The button is transparent on `bg-fin-surface` (SURFACE).
    const textRatio = contrastRatio(ink, SURFACE);
    const borderRatio = contrastRatio(border, SURFACE);
    expect(textRatio, `${textClass} on SURFACE = ${textRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      borderRatio,
      `${borderClass} on SURFACE = ${borderRatio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  test("(c) the active dock sub-label meets AA on the amber tab", () => {
    const tabs = (): DeskDockTab[] => [
      { key: "flow", label: "Delta", summary: <span>balanced</span>, content: <div>flow</div> },
      { key: "strips", label: "Desk", summary: <span>walls · breadth</span>, content: <div>desk</div> },
    ];
    render(
      () => <DeskDock tabs={tabs()} active="flow" onActiveChange={() => {}} />,
      { wrapper: UIProvider },
    );

    const button = screen.getByTestId("desk-dock-flow");
    expect(button).toHaveAttribute("aria-pressed", "true");
    const subLabel = button.children[1] as HTMLElement;
    expect(subLabel.textContent).toContain("balanced");

    const ink = subLabel.style.color || getComputedStyle(subLabel).color;
    expect(ink, "active sub-label must set an explicit readable ink").not.toBe("");
    const ratio = contrastRatio(ink, PRIMARY);
    expect(ratio, `${ink} on amber ${PRIMARY} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    // The chosen ink is the palette-derived readable colour, not a new hex.
    expect(parseColor(ink)).toEqual(parseColor(pickTextColor(PRIMARY)));
  });
});

describe("NiftyCoilGauge — labels are never ellipsised", () => {
  const regime = (): NiftyRegimeBlock => ({
    verdict: "trend_buy",
    range_pts: 150,
    range_baseline_pts: 100,
    range_pct: 150,
    rv: 13.1,
    iv: 14.8,
    straddle_open: 200,
    straddle_now: 180,
    straddle_pct: -10,
  });

  for (const compact of [true, false] as const) {
    test(`(d) ${compact ? "compact" : "full"} state and RV/IV labels keep their full text without an ellipsis`, () => {
      render(
        () => (
          <UIProvider>
            <NiftyCoilGauge regime={regime()} compact={compact} />
          </UIProvider>
        ),
      );

      for (const id of ["nifty-coil-state", "nifty-coil-rv-iv"]) {
        const label = screen.getByTestId(id) as HTMLElement;
        const style = label.style;
        expect(style.textOverflow, `${id} text-overflow`).not.toBe("ellipsis");
        expect(style.overflow, `${id} overflow`).not.toBe("hidden");
        expect(label.className, `${id} class`).not.toContain("truncate");
        expect(parseFloat(getComputedStyle(label).fontSize), `${id} floor`).toBeGreaterThanOrEqual(
          FLOOR,
        );
      }

      const rvIv = screen.getByTestId("nifty-coil-rv-iv");
      expect(rvIv).toHaveTextContent("RV 13.1 / IV 14.8");
      if (!compact) {
        expect(screen.getByTestId("nifty-coil-state")).toHaveTextContent("EXPANDING");
      } else {
        expect(screen.getByTestId("nifty-coil-gauge").getAttribute("title")).toContain(
          "EXPANDING",
        );
      }
    });
  }
});

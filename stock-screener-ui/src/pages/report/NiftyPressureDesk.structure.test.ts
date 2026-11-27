// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyPressureDesk.tsx";
const LINE_BUDGET = 450;

const MODULES: Record<string, string> = {
  "NiftyPressureDesk.format.ts": "export function panelTitleStyles",
  "NiftyPressureDesk.legend.tsx": "export function PressureDeskHeader",
  "NiftyPressureDesk.flow.tsx": "export function FlowPlane",
  "NiftyPressureDesk.ladder.tsx": "export function WallList",
  "NiftyPressureDesk.details.tsx": "export function WallRead",
  "NiftyPressureDesk.table.tsx": "export function PressureTable",
};

const MODULE_NAMES = Object.keys(MODULES);

describe("NiftyPressureDesk decomposition", () => {
  test("every section stays under the line budget", () => {
    for (const file of [FACADE, ...MODULE_NAMES]) {
      expect(lines(file), `${file} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps the stable public export", () => {
    expect(source(FACADE)).toContain("export function NiftyPressureDesk(");
  });

  test("each module keeps its stated responsibility", () => {
    for (const [module, snippet] of Object.entries(MODULES)) {
      expect(source(module), `${module} lost its responsibility`).toContain(snippet);
    }
  });

  test("facade delegates to every section instead of re-inlining them", () => {
    const facade = source(FACADE);
    for (const module of MODULE_NAMES) {
      expect(facade, `facade no longer imports ${module}`).toContain(
        `from "./${module.replace(/\.(ts|tsx)$/, "")}"`,
      );
    }
    for (const inlined of [
      'data-testid="pressure-plane-',
      'data-testid="pressure-row-',
      'data-testid="pressure-desk-table"',
      'data-testid="pressure-read-name"',
      'data-report-spacing="12"',
      'viewBox="0 0 520 500"',
      "const columns = pressureColumns()",
    ]) {
      expect(facade, `facade re-inlined ${inlined}`).not.toContain(inlined);
    }
  });

  test("every testid, rhythm marker and unit label survives the split", () => {
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    for (const token of [
      'data-testid="pressure-desk"',
      'data-testid="pressure-desk-empty"',
      'data-testid={`pressure-plane-${wall.key}`}',
      'data-testid={`pressure-row-${wall.key}`}',
      'data-testid="pressure-read-name"',
      'dataTestId="pressure-desk-table"',
      'getRowTestId={(wall) => `pressure-table-${wall.key}`}',
      'data-report-text="title"',
      'data-report-text="label"',
      'data-report-text="value"',
      'data-report-spacing="8"',
      'data-report-spacing="12"',
      "No walls tape at this replay time.",
      "Flow phase plane",
      "Selected wall",
      "Walls",
      "Current minute · full values",
      "30m path",
      "OI Δ / 30m %",
      "PREMIUM Δ / 30m %",
      "last 30 tape minutes",
      "indexed at start",
      "30m OI",
      "30m prem",
      "5m OI",
      " pts`",
      "% vs 5 / 15 / 30m",
    ]) {
      expect(all, `lost contract: ${token}`).toContain(token);
    }
  });

  test("the 16px title / 12px label / 13px value hierarchy stays token-driven", () => {
    expect(source("NiftyPressureDesk.format.ts")).toContain('"font-size": `${REPORT_FONT.value}px`');
    expect(source("NiftyPressureDesk.legend.tsx")).toContain(
      'class="font-mono text-ui-title font-black tracking-[0.08em] text-fin-text whitespace-nowrap"',
    );
    expect(source("NiftyPressureDesk.details.tsx")).toContain('"font-size": `${REPORT_FONT.lg}px`');
    expect(source("NiftyPressureDesk.details.tsx")).toContain('"font-size": `${REPORT_FONT.sm}px`');
    expect(source("NiftyPressureDesk.ladder.tsx")).toContain('"font-size": `${REPORT_FONT.body}px`');
    for (const module of ["NiftyPressureDesk.details.tsx", "NiftyPressureDesk.ladder.tsx"]) {
      expect(source(module)).toContain('"font-size": `${REPORT_FONT.micro}px`');
    }
  });
});

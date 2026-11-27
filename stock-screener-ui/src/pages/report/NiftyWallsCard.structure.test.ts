import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyWallsCard.tsx";
const MAX_LINES = 500;

const MODULES: Record<string, string> = {
  "NiftyWallsCard.shared.ts": "export const WALLS_ROWS",
  "NiftyWallsCard.stats.tsx": "export function Stat",
  "NiftyWallsCard.table.tsx": "export function WallTable",
  "NiftyWallsCard.history.tsx": "export function MiniHistory",
  "NiftyWallsCard.read.tsx": "export function WallsRead",
  "NiftyWallsCard.skeleton.tsx": "export function WallsSkeleton",
  "NiftyWallsCard.empty.tsx": "export function WallsEmpty",
  "NiftyWallsCard.card.tsx": "export function NiftyWallsCardInner",
};

describe("NiftyWallsCard decomposition", () => {
  test("facade re-exports the public card exports", () => {
    const facade = source(FACADE);
    for (const symbol of ["NiftyWallsCard", "NiftyWallsCardInner"]) {
      expect(facade, `missing re-export: ${symbol}`).toMatch(
        new RegExp(`\\b${symbol}\\b[\\s\\S]*?from "\\./NiftyWallsCard\\.card"`),
      );
    }
  });

  test("facade stays a facade", () => {
    const facade = source(FACADE);
    expect(lines(FACADE)).toBeLessThan(20);
    for (const implementation of ["createSignal", "data-testid", "WallsPayload", "REPORT_FONT"]) {
      expect(facade).not.toContain(implementation);
    }
  });

  test("every focused module stays under the line budget and keeps its responsibility", () => {
    for (const [module, exportSnippet] of Object.entries(MODULES)) {
      expect(lines(module), `${module} grew past the ${MAX_LINES}-line budget`).toBeLessThan(MAX_LINES);
      expect(source(module), `${module} lost its responsibility`).toContain(exportSnippet);
    }
  });

  test("card composes the focused modules instead of inlining them", () => {
    const card = source("NiftyWallsCard.card.tsx");
    for (const module of [
      "NiftyWallsCard.shared",
      "NiftyWallsCard.empty",
      "NiftyWallsCard.stats",
      "NiftyWallsCard.table",
      "NiftyWallsCard.history",
      "NiftyWallsCard.read",
      "NiftyWallsCard.skeleton",
    ]) {
      expect(card, `card no longer imports ${module}`).toContain(`from "./${module}"`);
    }
    // No card-level duplicate of the moved render bodies.
    expect(card).not.toContain("nifty-walls-skeleton-history");
    expect(card).not.toContain("WALL BREAK · {fmtNum");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("docs/DESIGN.md token table", () => {
  it("does not document a hex that is absent from palette.ts", () => {
    const design = read("docs/DESIGN.md");
    const palette = read("src/ui/palette.ts");
    const hexes = [...design.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0]);
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of new Set(hexes)) {
      expect(palette.toUpperCase(), `DESIGN.md documents ${hex}, but palette.ts does not`).toContain(
        hex.toUpperCase(),
      );
    }
  });
});

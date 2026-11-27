import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * solid-notifications ships its layout rules in `index.css`. Without the import
 * the toast wrapper is `position: static`, so the 52-unit SVG icon stretches to
 * the page width (the "giant arcs + X" screenshot).
 */
describe("toast stylesheet", () => {
  it("imports the library CSS in main.tsx", () => {
    const source = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    expect(source).toMatch(/import\s+["']solid-notifications\/index\.css["']/);
  });
});

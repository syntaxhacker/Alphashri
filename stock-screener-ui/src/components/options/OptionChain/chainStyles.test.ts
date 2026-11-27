import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStyles } from "./chainStyles";
import * as palette from "@/ui/palette";

const SOURCE = readFileSync(resolve(process.cwd(), "src/components/options/OptionChain/chainStyles.ts"), "utf8");

describe("chainStyles palette discipline", () => {
  it("contains no raw hex or rgba()/rgb() colour literals", () => {
    expect(SOURCE.match(/#[0-9a-fA-F]{6}\b/g), "raw #RRGGBB in chainStyles.ts").toBeNull();
    expect(SOURCE.match(/\brgba?\(/g), "raw rgb()/rgba() in chainStyles.ts").toBeNull();
  });

  it("derives the ATM and zebra tints from palette anchors", () => {
    const styles = getStyles(undefined, true);
    // #58A6FF -> #4D99FF (INDICATOR_BLUE_A): closest blue anchor, blue channel exact.
    expect(styles.atmHighlight["background-color"]).toBe(palette.alpha(palette.INDICATOR_BLUE_A, 0.14));
    // Pure white at 0.04 — TEXT_ON_ACCENT is #FFFFFF, an exact match.
    expect(styles.zebraRow["background-color"]).toBe(palette.alpha(palette.TEXT_ON_ACCENT, 0.04));
  });
});

describe("chain layout by viewport", () => {
  it("keeps the wide 11-column grid with strike pinned at its centre", () => {
    const styles = getStyles(undefined, true);
    expect(styles.row["grid-template-columns"]).toBe("repeat(5, 1fr) 80px repeat(5, 1fr)");
    expect(styles.strikeCell.left).toBe("calc(50% - 40px)");
    // The chain is a flex child, never a viewport-height reservation.
    expect(styles.container.flex).toBe("1 1 0%");
    expect(styles.container["min-height"]).toBe(0);
    expect(styles.container["flex-direction"]).toBe("column");
  });

  it("uses a five-column core grid and leading-edge strike pin when compact", () => {
    const styles = getStyles(undefined, true, { compact: true });
    expect(styles.row["grid-template-columns"]).toBe("1fr 1fr 80px 1fr 1fr");
    expect(styles.subHeader["grid-template-columns"]).toBe("1fr 1fr 80px 1fr 1fr");
    expect(styles.header["grid-template-columns"]).toBe("1fr 80px 1fr");
    expect(styles.strikeCell.left).toBe("0px");
    // Compact keeps the same bounded vertical scrollport as the wide grid.
    expect(styles.container.flex).toBe("1 1 0%");
    expect(styles.container["min-height"]).toBe(0);
  });

  it("pins strike to the leading edge in the narrow full-chain grid", () => {
    const styles = getStyles(undefined, true, { narrow: true });
    expect(styles.strikeCell.left).toBe("8px");
    expect(styles.row["grid-template-columns"]).toBe("repeat(5, 1fr) 80px repeat(5, 1fr)");
  });
});

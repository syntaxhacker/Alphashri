import { describe, expect, it } from "vitest";
import * as palette from "@/ui/palette";
import { alpha } from "@/utils/color";
import type { WallsRow } from "@/api/reportNifty";
import { newOiTint } from "./niftyWallsFormat";

const rows = [
  { strike: 24_700, oi: 1_000_000, new_oi: 1_000_000 },
  { strike: 24_600, oi: 2_000_000, new_oi: -500_000 },
] as WallsRow[];

describe("newOiTint", () => {
  it("derives the tint from a palette level token, not a hardcoded directional rgba", () => {
    // |1M| is the largest move in `rows`, so alpha = 0.06 + 0.06 = 0.12.
    const tint = newOiTint(1_000_000, rows);
    expect(tint).toBe(alpha(palette.LEVEL_MAX_PAIN, 0.12));
    expect(tint).not.toContain("22,163,74");
    expect(tint).not.toContain("220,38,38");
  });

  it("uses the same non-directional level token for both signs", () => {
    expect(newOiTint(1_000_000, rows)).toBe(newOiTint(-1_000_000, rows));
    expect(newOiTint(0, rows)).toBe("transparent");
    expect(newOiTint(null, rows)).toBe("transparent");
  });
});

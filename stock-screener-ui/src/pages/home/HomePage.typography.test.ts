// @vitest-environment node
/**
 * Typography contract for a representative page. The class must come from the
 * shared scale, and no private pixel size may be reintroduced beside it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TYPE_CLASS, TYPE_SCALE } from "@/ui/typography";

const source = readFileSync(new URL("./HomePage.tsx", import.meta.url), "utf8");

const PRIVATE_SIZE = /text-\[\d+(?:\.\d+)?px\]|["']?font-size["']?\s*[:=]\s*["']?\d+(?:\.\d+)?px|\bfontSize\s*[:=]\s*["']?\d+/g;

describe("HomePage typography tokens", () => {
  it("uses the shared micro token for dense labels", () => {
    expect(source).toContain(TYPE_CLASS.micro);
    expect(TYPE_SCALE.micro.size).toBe(12);
  });

  it("does not paint a private pixel font size", () => {
    expect(source.match(PRIVATE_SIZE) ?? []).toEqual([]);
  });
});

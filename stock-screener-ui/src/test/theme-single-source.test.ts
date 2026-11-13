// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as palette from "@/ui/palette";

const TOKENS: Array<[string, string]> = [
  ["--color-fin-bg", palette.BG_COLOR],
  ["--color-fin-surface", palette.SURFACE_COLOR],
  ["--color-fin-surface-alt", palette.SURFACE_ALT],
  ["--color-fin-border", palette.BORDER_COLOR],
  ["--color-fin-text", palette.TEXT_COLOR],
  ["--color-fin-text-muted", palette.TEXT_MUTED_COLOR],
  ["--color-fin-primary", palette.PRIMARY],
  ["--color-fin-positive", palette.POSITIVE_COLOR],
  ["--color-fin-negative", palette.NEGATIVE_COLOR],
  ["--color-fin-warning", palette.WARNING],
  ["--color-fin-info", palette.INFO],
];

const THEME_CSS = readFileSync(fileURLToPath(new URL("../tailwind.css", import.meta.url)), "utf8");

const themeValue = (token: string): string | undefined => {
  const match = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(THEME_CSS);
  return match?.[1].trim().toLowerCase();
};

describe("theme single source", () => {
  it("tailwind @theme mirrors every palette anchor", () => {
    const mismatched: string[] = [];
    for (const [token, expected] of TOKENS) {
      const actual = themeValue(token);
      if (actual !== expected.toLowerCase()) mismatched.push(`${token}: theme=${actual} palette=${expected}`);
    }
    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });

  it("no module outside palette.ts hardcodes a colour", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const SRC = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(full);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1);
      if (rel === "ui/palette.ts") continue;
      const text = readFileSync(file, "utf8");
      const hexes = text.match(/#[0-9a-fA-F]{6}\b/g);
      if (hexes) offenders.push(`${rel}: ${[...new Set(hexes)].join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("alpha() derives an rgba tint from an anchor", () => {
    expect(palette.alpha("#D9902A", 0.5)).toBe("rgba(217, 144, 42, 0.5)");
    expect(palette.alpha("#000", 1)).toBe("rgba(0, 0, 0, 1)");
  });
});

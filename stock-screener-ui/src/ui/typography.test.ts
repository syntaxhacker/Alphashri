// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TYPE_CLASS, TYPE_SCALE, typeSize, typeStyle, typeToken } from "./typography";
import { uiTheme } from "./theme";

const css = readFileSync(join(process.cwd(), "src/tailwind.css"), "utf8");

describe("typography tier", () => {
  it("declares one CSS custom property per role, matching the TS sizes", () => {
    for (const [role, step] of Object.entries(TYPE_SCALE)) {
      expect(css).toContain(`--text-ui-${role}: ${step.size}px;`);
      expect(css).toContain(`--text-ui-${role}--line-height: ${step.lineHeight}px;`);
      expect(typeToken(role as keyof typeof TYPE_SCALE)).toBe(`--text-ui-${role}`);
      expect(typeSize(role as keyof typeof TYPE_SCALE)).toBe(step.size);
    }
  });

  it("has a 12px floor and a strictly increasing, gap-free ladder", () => {
    const sizes = Object.values(TYPE_SCALE).map((step) => step.size);
    expect(sizes[0]).toBe(12);
    expect(sizes).toEqual([12, 13, 14, 16, 20, 24]);
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });

  it("exposes one class per role and keeps chart aliases on the same scale", () => {
    expect(Object.keys(TYPE_CLASS).sort()).toEqual(Object.keys(TYPE_SCALE).sort());
    for (const role of Object.keys(TYPE_SCALE) as Array<keyof typeof TYPE_SCALE>) {
      expect(TYPE_CLASS[role]).toBe(`text-ui-${role}`);
      expect(typeStyle(role)["font-size"]).toBe(`${TYPE_SCALE[role].size}px`);
    }
    expect(uiTheme.fontSizes.sm).toBe(`${TYPE_SCALE.micro.size}px`);
    expect(uiTheme.fontSizes.md).toBe(`${TYPE_SCALE.label.size}px`);
    expect(uiTheme.fontSizes.lg).toBe(`${TYPE_SCALE.title.size}px`);
    expect(uiTheme.fontSizes.xl).toBe(`${TYPE_SCALE.heading.size}px`);
  });
});

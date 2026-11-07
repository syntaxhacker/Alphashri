import { describe, expect, test } from "vitest";
import {
  changeChartColor,
  changeTextTone,
  qualityBadgeTone,
  qualityLabel,
  statusBadgeTone,
  statusChartColor,
  statusLabel,
} from "./patternTone";
import { PATTERN_CONFIRMED, PATTERN_FAILED, TEXT_MUTED } from "@/ui/palette";

describe("status helpers", () => {
  test("maps every known status to a badge tone and chart colour", () => {
    expect(statusBadgeTone("confirmed")).toBe("success");
    expect(statusBadgeTone("forming")).toBe("info");
    expect(statusBadgeTone("failed")).toBe("error");
    expect(statusBadgeTone("marginal")).toBe("warning");
    expect(statusBadgeTone("CONFIRMED")).toBe("success");
    expect(statusChartColor("confirmed")).toBe(PATTERN_CONFIRMED);
    expect(statusChartColor("failed")).toBe(PATTERN_FAILED);
  });

  test("falls back for unknown/empty statuses", () => {
    expect(statusBadgeTone(null)).toBe("default");
    expect(statusBadgeTone("sideways")).toBe("default");
    expect(statusChartColor(undefined)).toBe(TEXT_MUTED);
    expect(statusLabel("")).toBe("Unknown");
    expect(statusLabel("sideways")).toBe("Sideways");
  });
});

describe("quality helpers", () => {
  test("uses catalogue labels and tier tones", () => {
    expect(qualityLabel("textbook")).toBe("Textbook");
    expect(qualityBadgeTone("textbook")).toBe("success");
    expect(qualityBadgeTone("strong")).toBe("primary");
    expect(qualityBadgeTone("fair")).toBe("info");
    expect(qualityBadgeTone("marginal")).toBe("warning");
  });

  test("honours per-surface fallbacks", () => {
    expect(qualityLabel(null)).toBe("Unknown");
    expect(qualityLabel("", "—")).toBe("—");
    expect(qualityLabel("custom", "—")).toBe("Custom");
    expect(qualityBadgeTone(undefined)).toBe("default");
  });
});

describe("change helpers", () => {
  test("positive prints positive-style colours, negative prints negative", () => {
    expect(changeChartColor(1)).toBe(PATTERN_CONFIRMED);
    expect(changeChartColor(-1)).toBe(PATTERN_FAILED);
    expect(changeTextTone(1)).toBe("success");
    expect(changeTextTone(-1)).toBe("error");
  });

  test("non-finite values are muted", () => {
    expect(changeChartColor(null)).toBe(TEXT_MUTED);
    expect(changeChartColor(Number.NaN)).toBe(TEXT_MUTED);
    expect(changeTextTone(undefined)).toBe("dimmed");
  });
});

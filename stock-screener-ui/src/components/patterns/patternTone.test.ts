import { describe, expect, test } from "vitest";
import {
  changeChartColor,
  changeTextTone,
  displayToneColor,
  qualityBadgeTone,
  qualityLabel,
  statusBadgeTone,
  statusChartColor,
  statusLabel,
  textToneChartColor,
} from "./patternTone";
import {
  INFO,
  NEUTRAL,
  NEGATIVE,
  PATTERN_CONFIRMED,
  PATTERN_FAILED,
  POSITIVE,
  TEXT_MUTED,
  WARNING,
} from "@/ui/palette";

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

describe("textToneChartColor", () => {
  test("maps each text tone to its raw colour", () => {
    expect(textToneChartColor("success")).toBe(POSITIVE);
    expect(textToneChartColor("error")).toBe(NEGATIVE);
    expect(textToneChartColor("dimmed")).toBe(TEXT_MUTED);
  });

  test("is case-insensitive and mutes unknown/missing tones", () => {
    expect(textToneChartColor("SUCCESS")).toBe(POSITIVE);
    expect(textToneChartColor("Error")).toBe(NEGATIVE);
    expect(textToneChartColor(null)).toBe(TEXT_MUTED);
    expect(textToneChartColor(undefined)).toBe(TEXT_MUTED);
    expect(textToneChartColor("")).toBe(TEXT_MUTED);
    expect(textToneChartColor("primary")).toBe(TEXT_MUTED);
  });
});

describe("displayToneColor", () => {
  test("maps every display tone to its palette colour", () => {
    expect(displayToneColor("success")).toBe(POSITIVE);
    expect(displayToneColor("warning")).toBe(WARNING);
    expect(displayToneColor("error")).toBe(NEGATIVE);
    expect(displayToneColor("info")).toBe(INFO);
    expect(displayToneColor("neutral")).toBe(NEUTRAL);
  });

  test("falls back to the neutral colour for an unknown tone", () => {
    expect(displayToneColor("sideways" as never)).toBe(NEUTRAL);
  });
});

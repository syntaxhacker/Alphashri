import { describe, expect, it } from "vitest";
import {
  API_URL,
  SCREENERS_URL,
  NEW_ROW_HIGHLIGHT_MS,
  DEFAULT_AUTO_REFRESH_SECONDS,
  TIMEFRAMES,
  OR_MINUTES_OPTIONS,
} from "./constants";

describe("API Constants", () => {
  it("API_URL is constructed from VITE_API_BASE_URL", () => {
    expect(API_URL).toMatch(/^https?:\/\//);
    expect(API_URL).toContain("/api/screener");
  });

  it("SCREENERS_URL is constructed from VITE_API_BASE_URL", () => {
    expect(SCREENERS_URL).toMatch(/^https?:\/\//);
    expect(SCREENERS_URL).toContain("/api/screeners");
  });
});

describe("Timing Constants", () => {
  it("NEW_ROW_HIGHLIGHT_MS is positive number", () => {
    expect(NEW_ROW_HIGHLIGHT_MS).toBeGreaterThan(0);
    expect(NEW_ROW_HIGHLIGHT_MS).toBe(12000);
  });

  it("DEFAULT_AUTO_REFRESH_SECONDS is positive", () => {
    expect(DEFAULT_AUTO_REFRESH_SECONDS).toBeGreaterThan(0);
    expect(DEFAULT_AUTO_REFRESH_SECONDS).toBe(60);
  });
});

describe("TIMEFRAMES", () => {
  it("is an array of objects", () => {
    expect(Array.isArray(TIMEFRAMES)).toBe(true);
    TIMEFRAMES.forEach((tf) => {
      expect(tf).toHaveProperty("value");
      expect(tf).toHaveProperty("label");
    });
  });

  it("contains common timeframes", () => {
    const values = TIMEFRAMES.map((tf) => tf.value);
    expect(values).toContain(1);
    expect(values).toContain(5);
    expect(values).toContain(15);
    expect(values).toContain(30);
    expect(values).toContain(60);
    expect(values).toContain(1440);
  });

  it("contains correct labels", () => {
    const tf1 = TIMEFRAMES.find((tf) => tf.value === 1);
    expect(tf1?.label).toBe("1m");

    const tf5 = TIMEFRAMES.find((tf) => tf.value === 5);
    expect(tf5?.label).toBe("5m");

    const tf60 = TIMEFRAMES.find((tf) => tf.value === 60);
    expect(tf60?.label).toBe("1h");

    const tf1440 = TIMEFRAMES.find((tf) => tf.value === 1440);
    expect(tf1440?.label).toBe("1d");
  });

  it("values are unique", () => {
    const values = TIMEFRAMES.map((tf) => tf.value);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it("labels are unique", () => {
    const labels = TIMEFRAMES.map((tf) => tf.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(labels.length);
  });

  it("values are in ascending order", () => {
    for (let i = 1; i < TIMEFRAMES.length; i++) {
      expect(TIMEFRAMES[i].value).toBeGreaterThan(TIMEFRAMES[i - 1].value);
    }
  });

  it("contains expected timeframes", () => {
    expect(TIMEFRAMES).toHaveLength(9);
    const expected = [1, 5, 15, 30, 60, 120, 240, 720, 1440];
    expect(TIMEFRAMES.map((tf) => tf.value)).toEqual(expected);
  });
});

describe("OR_MINUTES_OPTIONS", () => {
  it("is an array of objects", () => {
    expect(Array.isArray(OR_MINUTES_OPTIONS)).toBe(true);
    OR_MINUTES_OPTIONS.forEach((opt) => {
      expect(opt).toHaveProperty("value");
      expect(opt).toHaveProperty("label");
    });
  });

  it("contains OR options", () => {
    const values = OR_MINUTES_OPTIONS.map((opt) => opt.value);
    expect(values).toContain(30);
    expect(values).toContain(45);
    expect(values).toContain(60);
    expect(values).toContain(120);
    expect(values).toContain(240);
  });

  it("labels match values with appropriate units", () => {
    OR_MINUTES_OPTIONS.forEach((opt) => {
      if (opt.value < 60) {
        expect(opt.label).toBe(`OR ${opt.value}m`);
      } else if (opt.value === 60) {
        expect(opt.label).toBe("OR 60m");
      } else {
        // Hours: 120 -> 2h, 240 -> 4h
        const hours = opt.value / 60;
        expect(opt.label).toBe(`OR ${hours}h`);
      }
    });
  });

  it("values are unique", () => {
    const values = OR_MINUTES_OPTIONS.map((opt) => opt.value);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it("values are in ascending order", () => {
    for (let i = 1; i < OR_MINUTES_OPTIONS.length; i++) {
      expect(OR_MINUTES_OPTIONS[i].value).toBeGreaterThan(OR_MINUTES_OPTIONS[i - 1].value);
    }
  });

  it("contains expected options", () => {
    expect(OR_MINUTES_OPTIONS).toHaveLength(5);
    expect(OR_MINUTES_OPTIONS.map((opt) => opt.value)).toEqual([30, 45, 60, 120, 240]);
  });
});

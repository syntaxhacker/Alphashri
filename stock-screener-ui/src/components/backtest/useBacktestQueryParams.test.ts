// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { compressToEncodedURIComponent } from "lz-string";
import { decodeConfig, encodeConfig, urlToPayload } from "./useBacktestQueryParams";

describe("backtest URL payload round-trip", () => {
  test("encodeConfig shortens keys and decodeConfig expands them back", () => {
    const encoded = encodeConfig({ strategy: "orb", symbols: ["RELIANCE"], days: 120 });
    expect(decodeConfig(encoded)).toEqual({
      strategy: "orb",
      symbols: ["RELIANCE"],
      days: 120,
    });
  });

  test("urlToPayload is null without the p param", () => {
    expect(urlToPayload(new URLSearchParams(""))).toBeNull();
    expect(urlToPayload(new URLSearchParams("?other=1"))).toBeNull();
  });

  // The spec-shaped payload is hand-compressed ({ s, y }) rather than run
  // through encodeConfig. expandKeys must still map the short keys, otherwise
  // every URL-driven symbol is silently dropped.
  test("short-key payloads decode to full keys", () => {
    const enc = compressToEncodedURIComponent(JSON.stringify({ s: "orb", y: ["RELIANCE"] }));
    expect(urlToPayload(new URLSearchParams(`?p=${enc}`))).toEqual({
      strategy: "orb",
      symbols: ["RELIANCE"],
    });
  });

  test("a corrupt payload decodes to null instead of throwing", () => {
    expect(urlToPayload(new URLSearchParams("?p=not-valid-lz"))).toBeNull();
  });
});

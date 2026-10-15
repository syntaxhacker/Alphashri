// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { copyToClipboard, toCsv, toSymbolList } from "./copyCsv";

describe("toCsv", () => {
  test("renders header from column keys and stringifies values", () => {
    const csv = toCsv(
      [
        { symbol: "RELIANCE", ltp: 2950.5, state: "armed" },
        { symbol: "TCS", ltp: 4050, state: "triggered" },
      ],
      [{ key: "symbol" }, { key: "ltp" }, { key: "state" }],
    );
    expect(csv).toBe("symbol,ltp,state\nRELIANCE,2950.5,armed\nTCS,4050,triggered");
  });

  test("uses header labels when provided", () => {
    const csv = toCsv([{ symbol: "RELIANCE" }], [{ key: "symbol", header: "Symbol" }]);
    expect(csv).toBe("Symbol\nRELIANCE");
  });

  test("infers columns from row keys when columns are omitted", () => {
    const csv = toCsv([{ a: 1, b: 2 }]);
    expect(csv).toBe("a,b\n1,2");
  });

  test("quotes fields containing commas", () => {
    const csv = toCsv([{ note: "a,b" }], [{ key: "note" }]);
    expect(csv).toBe('note\n"a,b"');
  });

  test("doubles quotes and wraps the field", () => {
    const csv = toCsv([{ note: 'say "hi"' }], [{ key: "note" }]);
    expect(csv).toBe('note\n"say ""hi"""');
  });

  test("quotes fields containing newlines", () => {
    const csv = toCsv([{ note: "line1\nline2" }], [{ key: "note" }]);
    expect(csv).toBe('note\n"line1\nline2"');
  });

  test("renders null/undefined as empty cells", () => {
    const csv = toCsv([{ a: null, b: undefined }], [{ key: "a" }, { key: "b" }]);
    expect(csv).toBe("a,b\n,");
  });
});

describe("toSymbolList", () => {
  test("joins symbols with commas", () => {
    expect(toSymbolList([{ symbol: "RELIANCE" }, { symbol: "TCS" }])).toBe(
      "NSE:RELIANCE,NSE:TCS",
    );
  });

  test("supports a custom key and skips blanks", () => {
    expect(
      toSymbolList([{ ticker: "AAA" }, { ticker: "" }, { ticker: "BBB" }], "ticker"),
    ).toBe("NSE:AAA,NSE:BBB");
  });

  test("does not double-prefix an already-prefixed symbol", () => {
    expect(toSymbolList([{ symbol: "NSE:INFY" }])).toBe("NSE:INFY");
  });

  test("prefix can be disabled", () => {
    expect(toSymbolList([{ symbol: "INFY" }], "symbol", "")).toBe("INFY");
  });

  test("returns an empty string for no rows", () => {
    expect(toSymbolList([])).toBe("");
  });
});

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  test("resolves false when navigator.clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });

  test("falls back to execCommand when clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
      writable: true,
    });
    await expect(copyToClipboard("fallback")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  test("resolves false when the fallback fails", async () => {
    vi.stubGlobal("navigator", {});
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
      writable: true,
    });
    await expect(copyToClipboard("fallback")).resolves.toBe(false);
  });
});

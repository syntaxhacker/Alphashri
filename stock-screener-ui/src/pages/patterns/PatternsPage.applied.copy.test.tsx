// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchPatternImages,
  fetchSymbolChart,
  makeHit,
  makeProps,
  r,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor, vi } = testHooks;

describe("PatternsPage copy CSV", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fetchPatternImages.mockResolvedValue({});
    fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("Copy CSV copies the result rows and shows a confirmation", async () => {
    const second = makeHit({
      id: 2,
      symbol: "TCS",
      name: "Tata Consultancy Services Ltd.",
      pattern_id: "rising_wedge",
      pattern_name: "Rising Wedge",
    });
    r(() => <PatternsPage {...makeProps({ results: [makeHit(), second], total: 2 })} />);

    fireEvent.click(screen.getByTestId("patterns-overflow"));
    fireEvent.click(await screen.findByTestId("patterns-copy-csv"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String(writeText.mock.calls[0][0]);
    const [header, ...lines] = text.split("\n");
    expect(header).toContain("Symbol");
    expect(header).toContain("Pattern");
    expect(text).toContain("IRCON");
    expect(text).toContain("TCS");
    expect(lines).toHaveLength(2);

    const toast = await screen.findByTestId("patterns-copy-toast");
    expect(toast).toHaveTextContent("Copied 2 rows");
  });

  test("Copy symbols copies the result symbols as a comma list", async () => {
    r(() => <PatternsPage {...makeProps()} />);

    fireEvent.click(screen.getByTestId("patterns-overflow"));
    fireEvent.click(await screen.findByTestId("patterns-copy-symbols"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toBe("NSE:IRCON");

    const toast = await screen.findByTestId("patterns-copy-toast");
    expect(toast).toHaveTextContent("Copied 1 symbol");
  });

  test("copy buttons are disabled when there are no results", async () => {
    r(() => <PatternsPage {...makeProps({ results: [], total: 0 })} />);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    // Overflow items are menu items: the menu signals disabled items via aria-disabled
    // (pointer-events:none blocks real clicks, same as the old buttons).
    expect(await screen.findByTestId("patterns-copy-csv")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(await screen.findByTestId("patterns-copy-symbols")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

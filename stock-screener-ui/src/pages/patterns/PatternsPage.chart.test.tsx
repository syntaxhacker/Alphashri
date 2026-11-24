// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  makeHit,
  makeProps,
  mockRefreshSymbolChart,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, vi } = testHooks;

const dockMatchMedia = (query: string) => ({
  matches: query.includes("1200px"),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

describe("PatternsPage chart", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("docks the chart beside the results and steps with the keyboard", async () => {
    vi.stubGlobal("matchMedia", dockMatchMedia);
    try {
      const first = makeHit({
        id: 11,
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        start_date: "2026-04-26",
      });
      const second = makeHit({
        id: 22,
        symbol: "RELIANCE",
        pattern_id: "rising_wedge",
        pattern_name: "Rising Wedge",
        start_date: "2026-07-01",
      });
      r(() => <PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

      fireEvent.click(
        screen.getByTestId(/^patterns-list-row-IRCON-falling_wedge/),
      );
      expect(await screen.findByTestId("patterns-chart-dock")).toBeInTheDocument();
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
      expect(screen.getByTestId("patterns-chart-position")).toHaveTextContent("1 / 2");

      fireEvent.click(screen.getByTestId("patterns-chart-next"));
      expect(await screen.findByTestId("patterns-chart-position")).toHaveTextContent("2 / 2");
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent(
        "Rising Wedge",
      );

      fireEvent.keyDown(document.body, { key: "ArrowUp" });
      expect(await screen.findByTestId("patterns-chart-position")).toHaveTextContent("1 / 2");
      expect(screen.getByTestId("patterns-chart-dock")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("clicking a list row opens the fullscreen chart", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("clicking a card opens the fullscreen chart", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("docked chart receives onRefresh and its button calls the hook's refresh once", async () => {
    vi.stubGlobal("matchMedia", dockMatchMedia);
    try {
      r(() => <PatternsPage {...makeProps({ results: [makeHit()], total: 1 })} />);
      fireEvent.click(screen.getByTestId(/^patterns-list-row-IRCON-falling_wedge/));
      expect(await screen.findByTestId("patterns-chart-dock")).toBeInTheDocument();
      const button = screen.getByTestId("patterns-dock-refresh");
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(mockRefreshSymbolChart).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("modal chart receives onRefresh and its button calls the hook's refresh once", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    const button = screen.getByTestId("patterns-dock-refresh");
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(mockRefreshSymbolChart).toHaveBeenCalledTimes(1);
  });
});

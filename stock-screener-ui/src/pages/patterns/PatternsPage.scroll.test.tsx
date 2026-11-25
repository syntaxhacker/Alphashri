// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeHit, makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
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

describe("PatternsPage scroll containment", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("page frame and scan panel clip their content", () => {
    r(() => <PatternsPage {...makeProps()} />);

    const page = screen.getByTestId("patterns-page");
    expect(page.className).toContain("h-full");
    expect(page.className).toContain("min-h-0");
    expect(page.className).toContain("overflow-hidden");

    const panel = screen.getByTestId("patterns-panel-scan");
    expect(panel.className).toContain("min-h-0");
    expect(panel.className).toContain("overflow-hidden");
  });

  test("grid view scrolls vertically inside the results pane", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    const scrollRegion = await screen.findByTestId("patterns-grid-scroll-region");
    expect(scrollRegion).toHaveAttribute("role", "region");
    expect((scrollRegion as HTMLElement).tabIndex).toBe(0);
    expect(scrollRegion.className).toContain("min-h-0");
    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(scrollRegion).toContainElement(screen.getByTestId("patterns-grid"));
  });

  test("desktop chart dock fills the results height instead of the viewport", async () => {
    vi.stubGlobal("matchMedia", dockMatchMedia);
    try {
      r(() => (
        <PatternsPage
          {...makeProps({
            results: [makeHit({ id: 11, symbol: "IRCON" })],
            total: 1,
          })}
        />
      ));

      fireEvent.click(await screen.findByTestId(/^patterns-list-row-IRCON-falling_wedge/));
      expect(await screen.findByTestId("patterns-chart-dock")).toBeInTheDocument();

      const shell = screen.getByTestId("patterns-chart-dock-shell");
      expect(shell.className).toContain("h-full");
      expect(shell.className).toContain("min-h-0");
      expect(shell.className).toContain("overflow-hidden");
      expect(shell.getAttribute("style") ?? "").not.toContain("100vh");
      expect(shell.getAttribute("style") ?? "").not.toContain("clamp(");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

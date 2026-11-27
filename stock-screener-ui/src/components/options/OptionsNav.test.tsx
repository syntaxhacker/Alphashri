// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionsNav } from "./OptionsNav";
import { SymbolDockContext } from "@/components/common/symbolDockContext";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionsNav", () => {
  it("renders all tabs", () => {
    render(() => <OptionsNav activeTab="chain" onTabChange={vi.fn()} />);
    expect(screen.getByText("Option Chain")).toBeInTheDocument();
    expect(screen.getByText("Positions")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Simulator")).toBeInTheDocument();
    expect(screen.queryByText("Greeks")).not.toBeInTheDocument();
  });

  it("keeps all five tab labels on one scrollable line without structural overlap", () => {
    render(() => <OptionsNav activeTab="chain" onTabChange={vi.fn()} />);
    const list = screen.getByTestId("options-nav-list");
    const tabs = screen.getAllByRole("tab");

    // The 34px bar cannot wrap, so the strip scrolls instead of letting
    // adjacent labels overlap at 390px.
    expect(list).toHaveClass("flex-nowrap");
    expect(list).toHaveClass("overflow-x-auto");
    expect(screen.getByTestId("options-nav-wrapper")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByTestId("options-analytics-link")).toHaveClass("shrink-0", "whitespace-nowrap");

    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Option Chain",
      "Positions",
      "Premium",
      "Simulator",
      "Positioning",
    ]);
    for (const tab of tabs) {
      expect(tab).toHaveClass("shrink-0");
      expect(tab).toHaveClass("whitespace-nowrap");
      expect(tab).not.toHaveClass("truncate");
      expect(tab.textContent).not.toMatch(/\s{2,}/);
    }
  });

  it("shows a narrow-only overflow cue that does not block the last tab", () => {
    render(() => <OptionsNav activeTab="chain" onTabChange={vi.fn()} />);
    const cue = screen.getByTestId("options-nav-overflow-cue");

    expect(cue).toHaveTextContent("→");
    expect(cue).toHaveClass("bg-gradient-to-l", "from-fin-surface", "lg:hidden");
    // The cue is decorative: it must never steal clicks from the last tab.
    expect(cue).toHaveAttribute("aria-hidden", "true");
    expect(cue).toHaveClass("pointer-events-none");

    // The strip keeps scrolling on one line, with scroll padding so the last
    // tab can clear the overlay cue.
    const list = screen.getByTestId("options-nav-list");
    expect(list).toHaveClass("flex-nowrap", "overflow-x-auto", "pr-8");
    expect(screen.getByTestId("nav-tab-positioning")).toHaveClass("whitespace-nowrap");
  });

  it("has clickable tabs", async () => {
    const onTabChange = vi.fn();
    render(() => <OptionsNav activeTab="chain" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("Positions"));
    expect(onTabChange).toHaveBeenCalledWith("positions");

    fireEvent.click(screen.getByText("Premium"));
    expect(onTabChange).toHaveBeenCalledWith("premium");
  });

  it("clicking Simulator tab emits simulator value", async () => {
    const onTabChange = vi.fn();
    render(() => <OptionsNav activeTab="premium" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("Simulator"));
    expect(onTabChange).toHaveBeenCalledWith("simulator");
  });

  it("marks active tab with correct value", () => {
    render(() => <OptionsNav activeTab="positions" onTabChange={vi.fn()} />);
    const tab = screen.getByTestId("nav-tab-positions");
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  it("reacts to a signal-backed activeTab after mutation", () => {
    const [activeTab, setActiveTab] = createSignal("chain");
    render(() => <OptionsNav activeTab={activeTab()} onTabChange={vi.fn()} />);

    expect(screen.getByTestId("nav-tab-chain")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("nav-tab-premium")).toHaveAttribute("aria-selected", "false");

    setActiveTab("premium");

    expect(screen.getByTestId("nav-tab-premium")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("nav-tab-chain")).toHaveAttribute("aria-selected", "false");
  });

  it("opens the options dock analytics instead of the standalone page", () => {
    const open = vi.fn();
    render(() => (
      <SymbolDockContext.Provider
        value={{
          preview: vi.fn(),
          endPreview: vi.fn(),
          open,
          close: vi.fn(),
          pinned: false,
          setOutlet: vi.fn(),
        }}
      >
        <OptionsNav activeTab="chain" onTabChange={vi.fn()} />
      </SymbolDockContext.Provider>
    ));

    const link = screen.getByTestId("options-analytics-link");
    expect(link.tagName).toBe("BUTTON");
    expect(link).not.toHaveAttribute("href");
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith("NIFTY", "options");
  });
});

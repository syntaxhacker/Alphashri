// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionsNav } from "./OptionsNav";

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
});

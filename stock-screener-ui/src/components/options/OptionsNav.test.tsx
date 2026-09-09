// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OptionsNav } from "./OptionsNav";
import { renderWithProviders } from "../../test-utils/renderWithProviders";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionsNav", () => {
  it("renders all three tabs", () => {
    renderWithProviders(<OptionsNav activeTab="chain" onTabChange={vi.fn()} />);
    expect(screen.getByText("Option Chain")).toBeInTheDocument();
    expect(screen.getByText("Positions")).toBeInTheDocument();
    expect(screen.getByText("Greeks")).toBeInTheDocument();
  });

  it("renders nav testid", () => {
    renderWithProviders(<OptionsNav activeTab="chain" onTabChange={vi.fn()} />);
    expect(screen.getByTestId("options-nav")).toBeInTheDocument();
  });

  it("has clickable tabs", async () => {
    const onTabChange = vi.fn();
    renderWithProviders(<OptionsNav activeTab="chain" onTabChange={onTabChange} />);
    await userEvent.click(screen.getByText("Positions"));
    expect(onTabChange).toHaveBeenCalledWith("positions");

    await userEvent.click(screen.getByText("Greeks"));
    expect(onTabChange).toHaveBeenCalledWith("greeks");
  });

  it("marks active tab with correct value", () => {
    renderWithProviders(<OptionsNav activeTab="positions" onTabChange={vi.fn()} />);
    const tab = screen.getByTestId("nav-tab-positions");
    expect(tab).toHaveAttribute("data-active");
  });
});

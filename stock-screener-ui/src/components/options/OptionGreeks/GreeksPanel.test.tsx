// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { GreeksPanel } from "./GreeksPanel";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GreeksPanel", () => {
  it("renders panel container", () => {
    renderWithProviders(<GreeksPanel />);
    expect(screen.getByTestId("options-greeks-panel")).toBeInTheDocument();
  });

  it("shows Greeks Analysis title", () => {
    renderWithProviders(<GreeksPanel />);
    expect(screen.getByText("Greeks Analysis")).toBeInTheDocument();
  });

  it("shows placeholder content", () => {
    renderWithProviders(<GreeksPanel />);
    expect(screen.getByText("Greeks visualization will appear here")).toBeInTheDocument();
  });
});

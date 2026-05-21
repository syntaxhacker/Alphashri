// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { GreeksPanel } from "./GreeksPanel";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";

afterEach(() => cleanup());

describe("GreeksPanel", () => {
  it("renders panel container", () => {
    renderWithMantine(<GreeksPanel />);
    expect(screen.getByTestId("options-greeks-panel")).toBeInTheDocument();
  });

  it("shows Greeks Analysis title", () => {
    renderWithMantine(<GreeksPanel />);
    expect(screen.getByText("Greeks Analysis")).toBeInTheDocument();
  });

  it("shows placeholder content", () => {
    renderWithMantine(<GreeksPanel />);
    expect(screen.getByText("Greeks visualization will appear here")).toBeInTheDocument();
  });
});

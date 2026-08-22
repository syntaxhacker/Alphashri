// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChainScrollActions } from "./ChainScrollActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChainScrollActions", () => {
  it("renders scroll action buttons", () => {
    renderWithMantine(
      <ChainScrollActions scrollToATM={vi.fn()} scrollToEdge={vi.fn()} />,
    );
    expect(screen.getByTestId("options-scroll-top-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-bottom-btn")).toBeInTheDocument();
  });

  it("renders container", () => {
    renderWithMantine(
      <ChainScrollActions scrollToATM={vi.fn()} scrollToEdge={vi.fn()} />,
    );
    expect(screen.getByTestId("options-chain-scroll-actions")).toBeInTheDocument();
  });
});

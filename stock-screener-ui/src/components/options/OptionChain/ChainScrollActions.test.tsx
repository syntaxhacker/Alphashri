// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { ChainScrollActions } from "./ChainScrollActions";

afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

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

// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

import { ChainScrollActions } from "./ChainScrollActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChainScrollActions", () => {
  it("renders scroll action buttons", () => {
    render(() => 
      <ChainScrollActions scrollToATM={vi.fn()} scrollToEdge={vi.fn()} />);
    expect(screen.getByTestId("options-scroll-top-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-bottom-btn")).toBeInTheDocument();
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
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

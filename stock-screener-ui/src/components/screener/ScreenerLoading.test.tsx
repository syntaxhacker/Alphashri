// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ScreenerLoading } from "./ScreenerLoading";
import { UIProvider } from "@/ui";

describe("ScreenerLoading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with default message", () => {
    render(() => (
      <UIProvider>
        <ScreenerLoading />
      </UIProvider>
    ));
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading screener")).toBeInTheDocument();
  });

});

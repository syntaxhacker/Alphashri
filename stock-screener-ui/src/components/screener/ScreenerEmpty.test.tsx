// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { UIProvider } from "@/ui";

describe("ScreenerEmpty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with custom message", () => {
    render(
      <UIProvider>
        <ScreenerEmpty message="No stocks match your criteria" />
      </UIProvider>,
    );
    expect(screen.getByText("No stocks match your criteria")).toBeInTheDocument();
  });
});

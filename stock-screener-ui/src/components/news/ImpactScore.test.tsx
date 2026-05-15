// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TestWrapper } from "../../test/test-utils";
import { ImpactScore } from "./ImpactScore";

describe("ImpactScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders high impact score (>= 7)", () => {
    render(<ImpactScore score={8} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("impact-score")).toBeInTheDocument();
    expect(screen.getByText("8/10")).toBeInTheDocument();
  });

  it("renders moderate impact score (>= 4 and < 7)", () => {
    render(<ImpactScore score={5} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("impact-score")).toBeInTheDocument();
    expect(screen.getByText("5/10")).toBeInTheDocument();
  });

  it("renders low impact score (< 4)", () => {
    render(<ImpactScore score={2} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("impact-score")).toBeInTheDocument();
    expect(screen.getByText("2/10")).toBeInTheDocument();
  });

  it("renders boundary score of 7 as high impact", () => {
    render(<ImpactScore score={7} />, { wrapper: TestWrapper });
    expect(screen.getByText(/High impact/)).toBeInTheDocument();
  });

  it("renders boundary score of 4 as moderate impact", () => {
    render(<ImpactScore score={4} />, { wrapper: TestWrapper });
    expect(screen.getByText(/Moderate impact/)).toBeInTheDocument();
  });
});

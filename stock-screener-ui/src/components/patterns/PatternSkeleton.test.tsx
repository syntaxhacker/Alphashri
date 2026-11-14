// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { PatternGridSkeleton, PatternSkeleton } from "./PatternSkeleton";

describe("PatternSkeleton", () => {
  afterEach(() => cleanup());

  test("renders one root placeholder for the whole route", () => {
    render(() => <PatternSkeleton />);
    expect(screen.getByTestId("patterns-skeleton")).toBeInTheDocument();
  });

  test("draws the three toolbar bands that the real page owns", () => {
    render(() => <PatternSkeleton />);
    expect(screen.getByTestId("patterns-skeleton-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-skeleton-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-skeleton-scope")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-skeleton-tools")).toBeInTheDocument();
  });

  test("reserves eight cards at the real card height", () => {
    render(() => <PatternSkeleton />);
    const cards = screen.getAllByTestId("patterns-skeleton-card");
    expect(cards).toHaveLength(8);
    for (const card of cards) {
      expect((card as HTMLElement).style.height).toBe("196px");
    }
  });

  test("never scrolls the page", () => {
    render(() => <PatternSkeleton />);
    const root = screen.getByTestId("patterns-skeleton");
    expect(root.className).toContain("flex-1");
    expect(root.className).toContain("min-h-0");
    expect(root.className).toContain("overflow-hidden");
  });

  test("announces loading to assistive tech", () => {
    render(() => <PatternSkeleton />);
    const root = screen.getByTestId("patterns-skeleton");
    expect(root).toHaveAttribute("role", "status");
    expect(root).toHaveAttribute("aria-busy", "true");
  });

  test("exposes a grid-only variant for the in-page loading state", () => {
    render(() => <PatternGridSkeleton />);
    expect(screen.getByTestId("patterns-skeleton-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-skeleton-card")).toHaveLength(8);
    expect(screen.queryByTestId("patterns-skeleton")).not.toBeInTheDocument();
  });
});

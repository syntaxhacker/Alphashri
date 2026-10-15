// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { ReactElement } from "react";
import type { SectorGroupsPayload } from "../../types/sector";

const mockFetchSectorGroups = vi.fn();

vi.mock("../../api/sector", () => ({
  fetchSectorGroups: (...args: unknown[]) => mockFetchSectorGroups(...args),
}));

import { GroupPerformancePanel } from "./GroupPerformancePanel";

const renderWithProvider = (ui: ReactElement) => render(<UIProvider>{ui}</UIProvider>);

function payload(groups: SectorGroupsPayload["groups"]): SectorGroupsPayload {
  return {
    classify: "sector",
    period: "1D",
    market: "india",
    last_updated: "2026-10-07T00:00:00Z",
    groups,
  };
}

const mockGroups = [
  { name: "Wires & Cables", change: 5.83, stock_count: 14, advances: 10, declines: 4 },
  { name: "IT", change: 2.0, stock_count: 20, advances: 12, declines: 8 },
  { name: "Banks", change: -4.0, stock_count: 10, advances: 2, declines: 8 },
];

describe("GroupPerformancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSectorGroups.mockResolvedValue(payload(mockGroups));
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the panel and fetches with defaults", async () => {
    renderWithProvider(<GroupPerformancePanel />);
    expect(screen.getByTestId("group-performance-panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchSectorGroups).toHaveBeenCalledWith(
        expect.objectContaining({ classify: "sector", period: "1D" }),
      );
    });
  });

  it("renders rows in the order given", async () => {
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-Wires & Cables")).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId(/^group-performance-row-/);
    expect(rows.map((r) => r.getAttribute("data-group"))).toEqual([
      "Wires & Cables",
      "IT",
      "Banks",
    ]);
  });

  it("scales bar width to the largest |change|", async () => {
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-bar-Wires & Cables")).toBeInTheDocument();
    });
    // maxAbs = 5.83 → 100%; IT = 2.0/5.83; Banks = 4.0/5.83
    expect(screen.getByTestId("group-performance-bar-Wires & Cables").style.width).toBe("100%");
    expect(screen.getByTestId("group-performance-bar-IT").style.width).toBe(
      `${(2.0 / 5.83) * 100}%`,
    );
    expect(screen.getByTestId("group-performance-bar-Banks").style.width).toBe(
      `${(4.0 / 5.83) * 100}%`,
    );
  });

  it("colors positive bars success and negative bars error", async () => {
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-bar-IT")).toBeInTheDocument();
    });
    expect(screen.getByTestId("group-performance-bar-Wires & Cables")).toHaveAttribute(
      "data-positive",
      "true",
    );
    expect(screen.getByTestId("group-performance-bar-Banks")).toHaveAttribute(
      "data-positive",
      "false",
    );
    expect(
      screen.getByTestId("group-performance-bar-Wires & Cables").style.backgroundColor,
    ).toBe("var(--mui-palette-success-main)");
    expect(screen.getByTestId("group-performance-bar-Banks").style.backgroundColor).toBe(
      "var(--mui-palette-error-main)",
    );
  });

  it("re-fetches when the period changes", async () => {
    const user = userEvent.setup();
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-IT")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("group-performance-period-1M"));
    await waitFor(() => {
      expect(mockFetchSectorGroups).toHaveBeenCalledWith(
        expect.objectContaining({ period: "1M" }),
      );
    });
  });

  it("re-fetches when classify changes", async () => {
    const user = userEvent.setup();
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-IT")).toBeInTheDocument();
    });
    const outer = screen.getByTestId("group-performance-classify");
    const combo = outer.querySelector('[role="combobox"]') ?? outer;
    await user.click(combo as Element);
    const option = await screen.findByRole("option", { name: /industry/i });
    await user.click(option);
    await waitFor(() => {
      expect(mockFetchSectorGroups).toHaveBeenCalledWith(
        expect.objectContaining({ classify: "industry" }),
      );
    });
  });

  it("re-fetches when classify changes to theme", async () => {
    const user = userEvent.setup();
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-IT")).toBeInTheDocument();
    });
    const outer = screen.getByTestId("group-performance-classify");
    const combo = outer.querySelector('[role="combobox"]') ?? outer;
    await user.click(combo as Element);
    const option = await screen.findByRole("option", { name: /^theme$/i });
    await user.click(option);
    await waitFor(() => {
      expect(mockFetchSectorGroups).toHaveBeenCalledWith(
        expect.objectContaining({ classify: "theme" }),
      );
    });
  });

  it("collapse toggle hides the list", async () => {
    const user = userEvent.setup();
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-list")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("group-performance-toggle"));
    expect(screen.queryByTestId("group-performance-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-performance-panel")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    // expand again
    await user.click(screen.getByTestId("group-performance-toggle"));
    expect(screen.getByTestId("group-performance-list")).toBeInTheDocument();
  });

  it("starts collapsed when defaultCollapsed is set", async () => {
    renderWithProvider(<GroupPerformancePanel defaultCollapsed />);
    expect(screen.queryByTestId("group-performance-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-performance-panel")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  it("calls onSelectGroup when a row is clicked", async () => {
    const user = userEvent.setup();
    const onSelectGroup = vi.fn();
    renderWithProvider(<GroupPerformancePanel onSelectGroup={onSelectGroup} />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-IT")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("group-performance-row-IT"));
    expect(onSelectGroup).toHaveBeenCalledWith("IT");
  });

  it("hides groups below the min-stocks threshold by default, shows them for All", async () => {
    const user = userEvent.setup();
    mockFetchSectorGroups.mockResolvedValue(
      payload([
        { name: "Solo", change: 30, stock_count: 1, advances: 1, declines: 0 },
        { name: "Big", change: 5, stock_count: 10, advances: 6, declines: 4 },
      ]),
    );
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-Big")).toBeInTheDocument();
    });
    // Default "3+" hides the single-stock group.
    expect(screen.queryByTestId("group-performance-row-Solo")).not.toBeInTheDocument();

    const outer = screen.getByTestId("group-performance-min-stocks");
    const combo = outer.querySelector('[role="combobox"]') ?? outer;
    await user.click(combo as Element);
    const option = await screen.findByRole("option", { name: /^all$/i });
    await user.click(option);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-row-Solo")).toBeInTheDocument();
    });
  });

  it("shows a loading state", () => {
    mockFetchSectorGroups.mockReturnValue(new Promise(() => {}));
    renderWithProvider(<GroupPerformancePanel />);
    expect(screen.getByTestId("group-performance-loading")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    mockFetchSectorGroups.mockRejectedValue(new Error("boom"));
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("group-performance-error")).toHaveTextContent("boom");
  });

  it("shows an empty state when there are no groups", async () => {
    mockFetchSectorGroups.mockResolvedValue(payload([]));
    renderWithProvider(<GroupPerformancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("group-performance-empty")).toBeInTheDocument();
    });
  });
});

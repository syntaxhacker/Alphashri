// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { PositioningStrikeTable, heatBg } from "./PositioningStrikeTable";
import type { PositioningStrikeRow } from "@/utils/positioning";

afterEach(() => {
  cleanup();
});

const mockRows: PositioningStrikeRow[] = [
  {
    strike: 25400.0,
    ce_class: "Short Buildup",
    ce_doi_shares: 125000,
    ce_cr: -32000.5,
    pe_class: "Long Buildup",
    pe_doi_shares: 50000,
    pe_cr: 1200.0,
    net_cr: -30800.5,
  },
  {
    strike: 25500.0,
    ce_class: "Short Covering",
    ce_doi_shares: null,
    ce_cr: null,
    pe_class: "Long Unwinding",
    pe_doi_shares: 10000,
    pe_cr: 500.0,
    net_cr: null,
  },
];

describe("heatBg", () => {
  test("returns undefined for null cr or non-positive max", () => {
    expect(heatBg(null, 100)).toBeUndefined();
    expect(heatBg(10, 0)).toBeUndefined();
  });

  test("scales alpha with intensity", () => {
    const faint = heatBg(10, 1000);
    const strong = heatBg(1000, 1000);
    expect(faint).toBeTruthy();
    expect(strong).toBeTruthy();
    expect(faint).not.toBe(strong);
  });
});

describe("PositioningStrikeTable", () => {
  test("renders table with strike rows", () => {
    renderWithProviders(<PositioningStrikeTable rows={mockRows} />);
    expect(screen.getByTestId("positioning-strike-table")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-25400")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-25500")).toBeInTheDocument();
  });

  test("renders strike, classes, shares, and Cr values", () => {
    renderWithProviders(<PositioningStrikeTable rows={mockRows} />);
    const row = screen.getByTestId("positioning-strike-row-25400");
    expect(within(row).getByText("25,400")).toBeInTheDocument();
    expect(within(row).getByText("Short Buildup")).toBeInTheDocument();
    expect(within(row).getByText("Long Buildup")).toBeInTheDocument();
    expect(within(row).getByText("1.3L")).toBeInTheDocument();
    expect(within(row).getByText("-32,000 Cr")).toBeInTheDocument();
    expect(within(row).getByText("1,200 Cr")).toBeInTheDocument();
    expect(within(row).getByText("-30,800 Cr")).toBeInTheDocument();
  });

  test("renders covering and unwinding badges", () => {
    renderWithProviders(<PositioningStrikeTable rows={mockRows} />);
    const row = screen.getByTestId("positioning-strike-row-25500");
    expect(within(row).getByText("Short Covering")).toBeInTheDocument();
    expect(within(row).getByText("Long Unwinding")).toBeInTheDocument();
  });

  test("renders em dash for null Cr and shares", () => {
    renderWithProviders(<PositioningStrikeTable rows={mockRows} />);
    const row = screen.getByTestId("positioning-strike-row-25500");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("renders empty message when rows are empty", () => {
    renderWithProviders(<PositioningStrikeTable rows={[]} />);
    expect(screen.getByTestId("positioning-strike-table")).toBeInTheDocument();
    expect(screen.getByText("No strikes to display")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-strike-row-25400")).not.toBeInTheDocument();
  });

  test("respects explicit maxAbsCr", () => {
    renderWithProviders(<PositioningStrikeTable rows={mockRows} maxAbsCr={100000} />);
    expect(screen.getByTestId("positioning-strike-row-25400")).toBeInTheDocument();
  });
});

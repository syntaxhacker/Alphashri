// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectorAlertsList } from "./SectorAlertsList";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SectorAlertsList", () => {
  it("shows empty state when no alerts", () => {
    renderWithMantine(<SectorAlertsList alerts={[]} />);
    expect(screen.getByText("Waiting for major movements...")).toBeInTheDocument();
  });

  it("renders alert with timestamp and sector name", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    renderWithMantine(<SectorAlertsList alerts={alerts} />);
    expect(screen.getByText(/10:30:00/)).toBeInTheDocument();
    expect(screen.getByText(/IT/)).toBeInTheDocument();
  });

  it("displays delta as formatted percentage", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    renderWithMantine(<SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("SURGING (1.50%)")).toBeInTheDocument();
  });

  it("shows DROPPING alert with negative percentage", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
    ];
    renderWithMantine(<SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("DROPPING (-0.80%)")).toBeInTheDocument();
  });

  it("renders multiple alerts", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
      { timestamp: "10:31:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
    ];
    renderWithMantine(<SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("SURGING (1.50%)")).toBeInTheDocument();
    expect(screen.getByText("DROPPING (-0.80%)")).toBeInTheDocument();
  });

  it("shows SURGING alert with green badge", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    const { container } = renderWithMantine(<SectorAlertsList alerts={alerts} />);
    const badge = container.querySelector(".mantine-Badge-root");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("SURGING");
  });

  it("shows DROPPING alert with red badge", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
    ];
    const { container } = renderWithMantine(<SectorAlertsList alerts={alerts} />);
    const badge = container.querySelector(".mantine-Badge-root");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("DROPPING");
  });
});

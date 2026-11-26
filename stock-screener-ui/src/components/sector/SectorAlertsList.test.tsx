// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SectorAlertsList } from "./SectorAlertsList";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SectorAlertsList", () => {
  it("shows empty state when no alerts", () => {
    render(() => <SectorAlertsList alerts={[]} />);
    expect(screen.getByText("Waiting for major movements...")).toBeInTheDocument();
  });

  it("renders alert with timestamp and sector name", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.getByText(/10:30:00/)).toBeInTheDocument();
    expect(screen.getByText(/IT/)).toBeInTheDocument();
  });

  it("displays delta as formatted percentage", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("SURGING (1.50%)")).toBeInTheDocument();
  });

  it("shows DROPPING alert with negative percentage", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("DROPPING (-0.80%)")).toBeInTheDocument();
  });

  it("renders multiple alerts", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
      { timestamp: "10:31:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("SURGING (1.50%)")).toBeInTheDocument();
    expect(screen.getByText("DROPPING (-0.80%)")).toBeInTheDocument();
  });

  it("shows SURGING alert with green badge", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("SURGING (1.50%)")).toBeInTheDocument();
    expect(screen.getByText(/SURGING/)).toBeInTheDocument();
  });

  it("shows DROPPING alert with red badge", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.getByText("DROPPING (-0.80%)")).toBeInTheDocument();
    expect(screen.getByText(/DROPPING/)).toBeInTheDocument();
  });

  it("turns the sector label into a real button with Enter/Space activation", () => {
    const onSectorClick = vi.fn();
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    render(() => <SectorAlertsList alerts={alerts} onSectorClick={onSectorClick} />);

    const button = screen.getByTestId("sector-alert-symbol-IT");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-label", "Open IT lead stock chart");

    fireEvent.click(button);
    expect(onSectorClick).toHaveBeenCalledWith("IT");
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onSectorClick).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(button, { key: " " });
    expect(onSectorClick).toHaveBeenCalledTimes(3);
  });

  it("leaves the label inert when no sector handler is supplied", () => {
    const alerts = [
      { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
    ];
    render(() => <SectorAlertsList alerts={alerts} />);
    expect(screen.queryByTestId("sector-alert-symbol-IT")).not.toBeInTheDocument();
  });
});

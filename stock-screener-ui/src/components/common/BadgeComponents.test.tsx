// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { SideBadge, ExitReasonBadge, StatusBadge } from "./BadgeComponents";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe("SideBadge", () => {
  it("renders BUY with green color and arrow", () => {
    render(<SideBadge side="BUY" />, { wrapper: Wrapper });
    expect(screen.getByText("▲ BUY")).toBeTruthy();
  });

  it("renders SELL with red color and arrow", () => {
    render(<SideBadge side="SELL" />, { wrapper: Wrapper });
    expect(screen.getByText("▼ SELL")).toBeTruthy();
  });

  it("renders LONG as green without arrow", () => {
    render(<SideBadge side="LONG" />, { wrapper: Wrapper });
    expect(screen.getByText("LONG")).toBeTruthy();
  });

  it("renders SHORT as red without arrow", () => {
    render(<SideBadge side="SHORT" />, { wrapper: Wrapper });
    expect(screen.getByText("SHORT")).toBeTruthy();
  });

  it("renders lowercase as uppercase", () => {
    render(<SideBadge side="buy" />, { wrapper: Wrapper });
    expect(screen.getByText("▲ BUY")).toBeTruthy();
  });

  it("renders with data-testid", () => {
    render(<SideBadge side="BUY" data-testid="side-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("side-badge")).toBeTruthy();
  });

  it("renders with custom size", () => {
    render(<SideBadge side="BUY" size="xs" />, { wrapper: Wrapper });
    expect(screen.getByText("▲ BUY")).toBeTruthy();
  });

  it("renders unknown side without arrow", () => {
    render(<SideBadge side="UNKNOWN" />, { wrapper: Wrapper });
    expect(screen.getByText("UNKNOWN")).toBeTruthy();
  });
});

describe("ExitReasonBadge", () => {
  it("renders TP with green color", () => {
    render(<ExitReasonBadge reason="TP" />, { wrapper: Wrapper });
    expect(screen.getByText("TP")).toBeTruthy();
  });

  it("renders SL with red color", () => {
    render(<ExitReasonBadge reason="SL" />, { wrapper: Wrapper });
    expect(screen.getByText("SL")).toBeTruthy();
  });

  it("renders stop_loss as SL with red", () => {
    render(<ExitReasonBadge reason="stop_loss" />, { wrapper: Wrapper });
    expect(screen.getByText("SL")).toBeTruthy();
  });

  it("renders target as Target with green", () => {
    render(<ExitReasonBadge reason="target" />, { wrapper: Wrapper });
    expect(screen.getByText("Target")).toBeTruthy();
  });

  it("renders trailing_stop as Trail with orange", () => {
    render(<ExitReasonBadge reason="trailing_stop" />, { wrapper: Wrapper });
    expect(screen.getByText("Trail")).toBeTruthy();
  });

  it("renders eod with orange", () => {
    render(<ExitReasonBadge reason="eod" />, { wrapper: Wrapper });
    expect(screen.getByText("eod")).toBeTruthy();
  });

  it("renders unknown reason as-is", () => {
    render(<ExitReasonBadge reason="timeout" />, { wrapper: Wrapper });
    expect(screen.getByText("timeout")).toBeTruthy();
  });

  it("renders with data-testid", () => {
    render(<ExitReasonBadge reason="TP" data-testid="exit-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("exit-badge")).toBeTruthy();
  });

  it("renders with custom size", () => {
    render(<ExitReasonBadge reason="TP" size="lg" />, { wrapper: Wrapper });
    expect(screen.getByText("TP")).toBeTruthy();
  });
});

describe("StatusBadge", () => {
  it("renders Running when running=true", () => {
    render(<StatusBadge running={true} />, { wrapper: Wrapper });
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("renders Running with PID when running=true and pid provided", () => {
    render(<StatusBadge running={true} pid={12345} />, { wrapper: Wrapper });
    expect(screen.getByText("Running (PID 12345)")).toBeTruthy();
  });

  it("renders Stopped when running=false", () => {
    render(<StatusBadge running={false} />, { wrapper: Wrapper });
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("renders with data-testid", () => {
    render(<StatusBadge running={true} data-testid="status-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("status-badge")).toBeTruthy();
  });

  it("renders with custom size", () => {
    render(<StatusBadge running={true} size="xl" />, { wrapper: Wrapper });
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it('renders "Unknown (Redis unavailable)" when statusUnknown=true', () => {
    render(<StatusBadge running={false} statusUnknown />, { wrapper: Wrapper });
    expect(screen.getByText("Unknown (Redis unavailable)")).toBeTruthy();
  });
});

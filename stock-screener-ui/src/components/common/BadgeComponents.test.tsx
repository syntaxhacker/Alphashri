// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { SideBadge, ExitReasonBadge, StatusBadge } from "./BadgeComponents";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

describe("SideBadge", () => {
  it("renders BUY with green color and arrow", () => {
    render(<SideBadge side="BUY" />, { wrapper: Wrapper });
    expect(screen.getByText("▲ BUY")).toBeInTheDocument();
  });

  it("renders SELL with red color and arrow", () => {
    render(<SideBadge side="SELL" />, { wrapper: Wrapper });
    expect(screen.getByText("▼ SELL")).toBeInTheDocument();
  });

  it("renders LONG as green without arrow", () => {
    render(<SideBadge side="LONG" />, { wrapper: Wrapper });
    expect(screen.getByText("LONG")).toBeInTheDocument();
  });

  it("renders SHORT as red without arrow", () => {
    render(<SideBadge side="SHORT" />, { wrapper: Wrapper });
    expect(screen.getByText("SHORT")).toBeInTheDocument();
  });

  it("renders lowercase as uppercase", () => {
    render(<SideBadge side="buy" />, { wrapper: Wrapper });
    expect(screen.getByText("▲ BUY")).toBeInTheDocument();
  });

  it("renders with data-testid", () => {
    render(<SideBadge side="BUY" data-testid="side-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("side-badge")).toBeInTheDocument();
  });

  it("renders with custom size", () => {
    render(<SideBadge side="BUY" size="xs" />, { wrapper: Wrapper });
    expect(screen.getByText("▲ BUY")).toBeInTheDocument();
  });

  it("renders unknown side without arrow", () => {
    render(<SideBadge side="UNKNOWN" />, { wrapper: Wrapper });
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
  });
});

describe("ExitReasonBadge", () => {
  it("renders TP with green color", () => {
    render(<ExitReasonBadge reason="TP" />, { wrapper: Wrapper });
    expect(screen.getByText("TP")).toBeInTheDocument();
  });

  it("renders SL with red color", () => {
    render(<ExitReasonBadge reason="SL" />, { wrapper: Wrapper });
    expect(screen.getByText("SL")).toBeInTheDocument();
  });

  it("renders stop_loss as SL with red", () => {
    render(<ExitReasonBadge reason="stop_loss" />, { wrapper: Wrapper });
    expect(screen.getByText("SL")).toBeInTheDocument();
  });

  it("renders target as Target with green", () => {
    render(<ExitReasonBadge reason="target" />, { wrapper: Wrapper });
    expect(screen.getByText("Target")).toBeInTheDocument();
  });

  it("renders trailing_stop as Trail with orange", () => {
    render(<ExitReasonBadge reason="trailing_stop" />, { wrapper: Wrapper });
    expect(screen.getByText("Trail")).toBeInTheDocument();
  });

  it("renders eod with orange", () => {
    render(<ExitReasonBadge reason="eod" />, { wrapper: Wrapper });
    expect(screen.getByText("eod")).toBeInTheDocument();
  });

  it("renders unknown reason as-is", () => {
    render(<ExitReasonBadge reason="timeout" />, { wrapper: Wrapper });
    expect(screen.getByText("timeout")).toBeInTheDocument();
  });

  it("renders with data-testid", () => {
    render(<ExitReasonBadge reason="TP" data-testid="exit-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("exit-badge")).toBeInTheDocument();
  });

  it("renders with custom size", () => {
    render(<ExitReasonBadge reason="TP" size="lg" />, { wrapper: Wrapper });
    expect(screen.getByText("TP")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders Running when running=true", () => {
    render(<StatusBadge running={true} />, { wrapper: Wrapper });
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders Running with PID when running=true and pid provided", () => {
    render(<StatusBadge running={true} pid={12345} />, { wrapper: Wrapper });
    expect(screen.getByText("Running (PID 12345)")).toBeInTheDocument();
  });

  it("renders Stopped when running=false", () => {
    render(<StatusBadge running={false} />, { wrapper: Wrapper });
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("renders with data-testid", () => {
    render(<StatusBadge running={true} data-testid="status-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("status-badge")).toBeInTheDocument();
  });

  it("renders with custom size", () => {
    render(<StatusBadge running={true} size="xl" />, { wrapper: Wrapper });
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});

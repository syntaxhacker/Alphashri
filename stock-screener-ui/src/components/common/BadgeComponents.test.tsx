// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { SideBadge, ExitReasonBadge, StatusBadge, TradingModeBadge } from "./BadgeComponents";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function getChipRoot(testId?: string): HTMLElement | null {
  if (testId) {
    const badge = screen.getByTestId(testId);
    return badge;
  }
  return null;
}

describe("SideBadge", () => {
  it("renders BUY with green color and arrow", () => {
    render(() => (<SideBadge side="BUY" data-testid="b" />));
    expect(screen.getByText("▲ BUY")).toBeInTheDocument();
    const el = getChipRoot("b")!;
    expect(el).toBeInTheDocument();
  });

  it("renders SELL with red color and arrow", () => {
    render(() => (<SideBadge side="SELL" data-testid="s" />));
    expect(screen.getByText("▼ SELL")).toBeInTheDocument();
  });

  it("renders LONG as green (BUY semantics) with contrast text", () => {
    render(() => (<SideBadge side="LONG" data-testid="long" />));
    expect(screen.getByText("LONG")).toBeInTheDocument();
    const el = screen.getByTestId("long");
    expect(el).toBeInTheDocument();
  });

  it("renders SHORT as SELL semantics red without arrow", () => {
    render(() => (<SideBadge side="SHORT" data-testid="short" />));
    expect(screen.getByText("SHORT")).toBeInTheDocument();
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("renders lowercase as uppercase", () => {
    render(() => (<SideBadge side="buy" />));
    expect(screen.getByText("▲ BUY")).toBeInTheDocument();
  });

  it("renders unknown side without arrow and as red", () => {
    render(() => (<SideBadge side="UNKNOWN" data-testid="unk" />));
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("handles empty side string without crash", () => {
    render(() => (<SideBadge side="" data-testid="empty" />));
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

});

describe("ExitReasonBadge", () => {
  it("renders TP with green color", () => {
    render(() => (<ExitReasonBadge reason="TP" />));
    expect(screen.getByText("TP")).toBeInTheDocument();
  });

  it("renders SL with red color", () => {
    render(() => (<ExitReasonBadge reason="SL" />));
    expect(screen.getByText("SL")).toBeInTheDocument();
  });

  it("renders stop_loss as SL with red", () => {
    render(() => (<ExitReasonBadge reason="stop_loss" />));
    expect(screen.getByText("SL")).toBeInTheDocument();
  });

  it("renders target as Target with green", () => {
    render(() => (<ExitReasonBadge reason="target" />));
    expect(screen.getByText("Target")).toBeInTheDocument();
  });

  it("renders trailing_stop as Trail with orange", () => {
    render(() => (<ExitReasonBadge reason="trailing_stop" />));
    expect(screen.getByText("Trail")).toBeInTheDocument();
  });

  it("renders eod with orange", () => {
    render(() => (<ExitReasonBadge reason="eod" />));
    expect(screen.getByText("eod")).toBeInTheDocument();
  });

  it("renders unknown reason as-is gray", () => {
    render(() => (<ExitReasonBadge reason="timeout" />));
    expect(screen.getByText("timeout")).toBeInTheDocument();
  });

  it("handles empty reason gracefully", () => {
    render(() => (<ExitReasonBadge reason="" data-testid="empty-exit" />));
    expect(screen.getByTestId("empty-exit")).toBeInTheDocument();
  });

  it("handles null/undefined reason via fallback", () => {
    render(() => (<ExitReasonBadge reason={undefined as any} data-testid="undef-exit" />));
    expect(screen.getByTestId("undef-exit")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders Running when running=true", () => {
    render(() => (<StatusBadge running={true} />));
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
  });

  it("renders Stopped when running=false", () => {
    render(() => (<StatusBadge running={false} />));
    expect(screen.getByText("STOPPED")).toBeInTheDocument();
  });

  it("renders Unknown when statusUnknown", () => {
    render(() => (<StatusBadge running={false} statusUnknown data-testid="unknown" />));
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
  });
});

describe("TradingModeBadge", () => {
  it("renders LIVE as red filled when liveTrading true", () => {
    render(() => (<TradingModeBadge liveTrading={true} />));
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("renders PAPER as green filled when liveTrading false", () => {
    render(() => (<TradingModeBadge liveTrading={false} />));
    expect(screen.getByText("PAPER")).toBeInTheDocument();
  });
});

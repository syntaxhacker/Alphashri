// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { SideBadge, ExitReasonBadge, StatusBadge, TradingModeBadge } from "./BadgeComponents";

// Filled badges paint the tone as a theme token, not the fixed dark anchor:
// the fill must re-tone in light mode or the near-white label fails contrast.
const TONE_COLOR: Record<string, string> = {
  success: "var(--ui-badge-positive-main)",
  error: "var(--ui-badge-negative-main)",
  warning: "var(--ui-badge-warning-main)",
  info: "var(--ui-badge-info-main)",
  secondary: "var(--ui-badge-muted-main)",
  neutral: "var(--ui-badge-muted-main)",
};

function expectTone(el: HTMLElement, tone: keyof typeof TONE_COLOR) {
  expect(el.style.backgroundColor).toBe(TONE_COLOR[tone]);
}

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

describe("ExitReasonBadge — reason families", () => {
  it("maps stop-loss enum, human string and PnL variant to error", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="STOP_LOSS" data-testid="sl-enum" />
        <ExitReasonBadge reason="Stop loss hit ₹1340.00" data-testid="sl-human" />
        <ExitReasonBadge reason="Stop loss hit ₹1340.00 (PnL: -0.40%)" data-testid="sl-pnl" />
      </>
    ));
    const enumEl = screen.getByTestId("sl-enum");
    expect(enumEl.textContent).toBe("SL");
    expectTone(enumEl, "error");
    const humanEl = screen.getByTestId("sl-human");
    expect(humanEl.textContent).toBe("Stop loss hit ₹1340.00");
    expectTone(humanEl, "error");
    const pnlEl = screen.getByTestId("sl-pnl");
    expect(pnlEl.textContent).toBe("Stop loss hit ₹1340.00 (PnL: -0.40%)");
    expectTone(pnlEl, "error");
  });

  it("maps target enum, human string and PnL variant to success", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="TARGET" data-testid="tp-enum" />
        <ExitReasonBadge reason="TAKE_PROFIT" data-testid="tp-code" />
        <ExitReasonBadge reason="Target hit ₹1500.00" data-testid="tp-human" />
        <ExitReasonBadge reason="Take profit hit ₹1500.00 (PnL: +1.50%)" data-testid="tp-pnl" />
      </>
    ));
    expect(screen.getByTestId("tp-enum").textContent).toBe("Target");
    expectTone(screen.getByTestId("tp-enum"), "success");
    expectTone(screen.getByTestId("tp-code"), "success");
    expect(screen.getByTestId("tp-human").textContent).toBe("Target hit ₹1500.00");
    expectTone(screen.getByTestId("tp-human"), "success");
    expect(screen.getByTestId("tp-pnl").textContent).toBe("Take profit hit ₹1500.00 (PnL: +1.50%)");
    expectTone(screen.getByTestId("tp-pnl"), "success");
  });

  it("maps trailing-stop enum, human string and PnL variant to warning", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="TRAILING_STOP" data-testid="trail-enum" />
        <ExitReasonBadge reason="Trailing stop hit ₹1500.00" data-testid="trail-human" />
        <ExitReasonBadge reason="Exit: TRAILING_STOP (PnL: +0.50%)" data-testid="trail-pnl" />
        <ExitReasonBadge reason="52W Target exit: TRAILING_STOP (PnL: +0.20%)" data-testid="trail-decisive" />
      </>
    ));
    expect(screen.getByTestId("trail-enum").textContent).toBe("Trail");
    expectTone(screen.getByTestId("trail-enum"), "warning");
    expectTone(screen.getByTestId("trail-human"), "warning");
    expect(screen.getByTestId("trail-pnl").textContent).toBe("Exit: TRAILING_STOP (PnL: +0.50%)");
    expectTone(screen.getByTestId("trail-pnl"), "warning");
    expectTone(screen.getByTestId("trail-decisive"), "warning");
  });

  it("maps force-close/EOD enum, human string and PnL variant to warning", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="FORCE_CLOSE" data-testid="force-enum" />
        <ExitReasonBadge reason="EOD force exit (15:00)" data-testid="force-human" />
        <ExitReasonBadge reason="EOD force exit (15:00) (PnL: +0.20%)" data-testid="force-pnl" />
      </>
    ));
    expect(screen.getByTestId("force-enum").textContent).toBe("Force");
    expectTone(screen.getByTestId("force-enum"), "warning");
    expectTone(screen.getByTestId("force-human"), "warning");
    expect(screen.getByTestId("force-pnl").textContent).toBe("EOD force exit (15:00) (PnL: +0.20%)");
    expectTone(screen.getByTestId("force-pnl"), "warning");
  });

  it("maps max-holding enum, human string and PnL variant to info", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="MAX_HOLDING" data-testid="hold-enum" />
        <ExitReasonBadge reason="Max holding (5d)" data-testid="hold-human" />
        <ExitReasonBadge reason="Exit: MAX_HOLDING (PnL: -0.10%)" data-testid="hold-pnl" />
        <ExitReasonBadge reason="52W Target exit: MAX_HOLDING (PnL: -0.10%)" data-testid="hold-decisive" />
      </>
    ));
    expect(screen.getByTestId("hold-enum").textContent).toBe("Max Hold");
    expectTone(screen.getByTestId("hold-enum"), "info");
    expectTone(screen.getByTestId("hold-human"), "info");
    expect(screen.getByTestId("hold-pnl").textContent).toBe("Exit: MAX_HOLDING (PnL: -0.10%)");
    expectTone(screen.getByTestId("hold-pnl"), "info");
    expectTone(screen.getByTestId("hold-decisive"), "info");
  });

  it("maps new-52w-high enum, human string and PnL variant to success", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="NEW_52W_HIGH" data-testid="high-enum" />
        <ExitReasonBadge reason="52W high target reached ₹1500.00" data-testid="high-human" />
        <ExitReasonBadge reason="Exit: NEW_52W_HIGH (PnL: +2.00%)" data-testid="high-pnl" />
      </>
    ));
    expect(screen.getByTestId("high-enum").textContent).toBe("52W High");
    expectTone(screen.getByTestId("high-enum"), "success");
    expect(screen.getByTestId("high-human").textContent).toBe("52W high target reached ₹1500.00");
    expectTone(screen.getByTestId("high-human"), "success");
    expect(screen.getByTestId("high-pnl").textContent).toBe("Exit: NEW_52W_HIGH (PnL: +2.00%)");
    expectTone(screen.getByTestId("high-pnl"), "success");
  });

  it("maps manual-close enum, human string and PnL variant to secondary", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="MANUAL_CLOSE" data-testid="manual-enum" />
        <ExitReasonBadge reason="Manual" data-testid="manual-human" />
        <ExitReasonBadge reason="MANUAL (PnL: +0.05%)" data-testid="manual-pnl" />
      </>
    ));
    expect(screen.getByTestId("manual-enum").textContent).toBe("Manual");
    expectTone(screen.getByTestId("manual-enum"), "secondary");
    expect(screen.getByTestId("manual-human").textContent).toBe("Manual");
    expectTone(screen.getByTestId("manual-human"), "secondary");
    expect(screen.getByTestId("manual-pnl").textContent).toBe("MANUAL (PnL: +0.05%)");
    expectTone(screen.getByTestId("manual-pnl"), "secondary");
  });

  it("keeps an unknown reason's text with a neutral tone", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="timeout" data-testid="unknown-a" />
        <ExitReasonBadge reason="REV" data-testid="unknown-b" />
        <ExitReasonBadge reason="broker sent something new (PnL: +1.00%)" data-testid="unknown-c" />
      </>
    ));
    expect(screen.getByTestId("unknown-a").textContent).toBe("timeout");
    expectTone(screen.getByTestId("unknown-a"), "neutral");
    expect(screen.getByTestId("unknown-b").textContent).toBe("REV");
    expectTone(screen.getByTestId("unknown-b"), "neutral");
    expect(screen.getByTestId("unknown-c").textContent).toBe("broker sent something new (PnL: +1.00%)");
    expectTone(screen.getByTestId("unknown-c"), "neutral");
  });

  it("tolerates separator and case variants", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="stop-loss" data-testid="fmt-dash" />
        <ExitReasonBadge reason="  TRAILING   STOP  " data-testid="fmt-space" />
        <ExitReasonBadge reason="new_52w_high" data-testid="fmt-underscore" />
      </>
    ));
    expect(screen.getByTestId("fmt-dash").textContent).toBe("SL");
    expectTone(screen.getByTestId("fmt-dash"), "error");
    expect(screen.getByTestId("fmt-space").textContent).toBe("Trail");
    expectTone(screen.getByTestId("fmt-space"), "warning");
    expect(screen.getByTestId("fmt-underscore").textContent).toBe("52W High");
    expectTone(screen.getByTestId("fmt-underscore"), "success");
  });

  it("renders empty and nullish reasons with a neutral tone without crashing", () => {
    render(() => (
      <>
        <ExitReasonBadge reason="" data-testid="tone-empty" />
        <ExitReasonBadge reason={null as any} data-testid="tone-null" />
      </>
    ));
    expectTone(screen.getByTestId("tone-empty"), "neutral");
    expectTone(screen.getByTestId("tone-null"), "neutral");
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

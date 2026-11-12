// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ReplayStats } from "./ReplayStats";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("ReplayStats", () => {
  it("shows empty state when no trades and not running", () => {
    render(() => <UIProvider>
        <ReplayStats trades={[]} summary={null} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
    expect(screen.getByText("Run a replay to see stats")).toBeInTheDocument();
  });

  it("shows Progress bar when running and totalCandles > 0", () => {
    const progress = { candle: 50, total: 200, time: "10:30", symbol: "TCS" };
    render(() => <UIProvider>
        <ReplayStats trades={[]} summary={null} progress={progress} totalCandles={200} isRunning={true} />
      </UIProvider>,
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

});

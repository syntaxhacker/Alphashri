// @vitest-environment happy-dom
import { render, cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { UIProvider } from "@/ui";
import { BacktestRightRail } from "./BacktestRightRail";

afterEach(cleanup);

const mount = (width: number) =>
  render(
    () => (
      <UIProvider>
        <BacktestRightRail width={width} onWidthChange={() => {}}>
          <div>child</div>
        </BacktestRightRail>
      </UIProvider>
    ),
    { wrapper: (p) => <>{p.children}</> },
  );

describe("BacktestRightRail width contract", () => {
  test("pins an explicit width so the chart keeps the remaining space", () => {
    const { container } = mount(440);
    const rail = container.querySelector('[data-testid="backtest-rail"]') as HTMLElement;
    expect(rail).toBeTruthy();
    console.log("RAIL-STYLE " + (rail.getAttribute("style") ?? "NO-STYLE"));
    expect(rail.style.width).toBe("440px");
    expect(rail.style.minWidth).toBe("320px");
    expect(rail.style.maxWidth).toBe("760px");
  });
});

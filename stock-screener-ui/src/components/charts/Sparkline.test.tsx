// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { UIProvider } from "@/ui";
import { Sparkline } from "./Sparkline";
import { Sparkline as ScreenerSparkline } from "@/components/screener/Sparkline";
import { Sparkline as CommonSparkline } from "@/components/common/Sparkline";

afterEach(cleanup);

describe("shared Sparkline", () => {
  test("both legacy paths alias the single implementation", () => {
    expect(ScreenerSparkline).toBe(Sparkline);
    expect(CommonSparkline).toBe(Sparkline);
  });

  test("data prop keeps the screener contract", () => {
    render(() => (
      <UIProvider>
        <Sparkline data={[0.1, 0.3, 0.6, 0.9]} change={19.99} />
      </UIProvider>
    ));
    const spark = screen.getByTestId("sparkline");
    expect(spark).toHaveAttribute("data-positive", "true");
    expect(spark).toHaveAttribute("data-points", "4");
    expect(spark.querySelector("polyline")).toHaveAttribute("stroke", "var(--color-fin-positive)");
  });

  test("values prop keeps the chart contract", () => {
    render(() => (
      <UIProvider>
        <Sparkline values={[1, 2, 3]} width={30} height={8} testId="spark-shared" animate />
      </UIProvider>
    ));
    const svg = screen.getByTestId("spark-shared");
    expect(svg).toHaveAttribute("viewBox", "0 0 30 8");
    expect(svg.querySelector("polyline")).toHaveAttribute("pathLength", "1");
  });
});

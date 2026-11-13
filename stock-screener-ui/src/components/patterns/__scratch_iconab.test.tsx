// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { describe, expect, test } from "vitest";
import { render } from "@solidjs/testing-library";
import { Icon } from "@/components/common/Icons";
import * as IconsOrig from "./__scratch_icons_orig";

const N = 200;
function timeIt(Comp: (props: { size?: number }) => any) {
  const t0 = performance.now();
  render(() => (
    <>
      {Array.from({ length: N }, (_, i) => (
        <div data-i={i}>
          <Comp size={12} />
        </div>
      ))}
    </>
  ));
  const ms = performance.now() - t0;
  document.body.innerHTML = "";
  return ms;
}
const OrigMax = (props: { size?: number }) => <IconsOrig.Icon name="arrows-maximize" {...props} />;
const NewMax = (props: { size?: number }) => <Icon name="arrows-maximize" {...props} />;
const OrigCandle = (props: { size?: number }) => <IconsOrig.Icon name="chart-candle" {...props} />;
const NewCandle = (props: { size?: number }) => <Icon name="chart-candle" {...props} />;

const med = (x: number[]) => x.slice().sort((p, q) => p - q)[4];

describe("icon A/B", () => {
  test("orig vs merged", () => {
    timeIt(OrigMax); timeIt(NewMax); timeIt(OrigCandle); timeIt(NewCandle);
    const a1: number[] = []; const b1: number[] = [];
    const a2: number[] = []; const b2: number[] = [];
    for (let i = 0; i < 9; i++) {
      a1.push(timeIt(OrigMax)); b1.push(timeIt(NewMax));
      a2.push(timeIt(OrigCandle)); b2.push(timeIt(NewCandle));
    }
    // eslint-disable-next-line no-console
    console.log(`[PERF] maximize x${N}: orig ${med(a1).toFixed(1)} ms -> merged ${med(b1).toFixed(1)} ms (${(((med(b1) - med(a1)) / med(a1)) * 100).toFixed(0)}%)`);
    // eslint-disable-next-line no-console
    console.log(`[PERF] candle   x${N}: orig ${med(a2).toFixed(1)} ms -> merged ${med(b2).toFixed(1)} ms (${(((med(b2) - med(a2)) / med(a2)) * 100).toFixed(0)}%)`);
    expect(N).toBe(200);
  }, 180000);
});
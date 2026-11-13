// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/testing-library";
import { For } from "solid-js";

const MAX = [
  ["path", { d: "M16 4l4 0l0 4" }],
  ["path", { d: "M14 10l6 -6" }],
  ["path", { d: "M8 20l-4 0l0 -4" }],
  ["path", { d: "M4 20l6 -6" }],
  ["path", { d: "M16 20l4 0l0 -4" }],
  ["path", { d: "M14 14l6 6" }],
  ["path", { d: "M8 4l-4 0l0 4" }],
  ["path", { d: "M4 4l6 6" }],
] as const;

const MERGED = MAX.map(([, a]) => a.d).join("");

function ManyPaths() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2}>
      <For each={MAX}>{( [, a ]) => <path d={a.d} />}</For>
    </svg>
  );
}
function OnePath() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2}>
      <path d={MERGED} />
    </svg>
  );
}

const N = 200;
const timeIt = (Comp: any) => {
  const t0 = performance.now();
  render(() => (
    <>
      {Array.from({ length: N }, (_, i) => (
        <div data-i={i}>
          <Comp />
        </div>
      ))}
    </>
  ));
  const ms = performance.now() - t0;
  document.body.innerHTML = "";
  return ms;
};

describe("icon node count", () => {
  test("many vs one path", () => {
    timeIt(ManyPaths);
    timeIt(OnePath);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 9; i++) {
      a.push(timeIt(ManyPaths));
      b.push(timeIt(OnePath));
    }
    const med = (x: number[]) => x.slice().sort((p, q) => p - q)[4];
    // eslint-disable-next-line no-console
    console.log(`[PERF] 8 paths x${N}: median ${med(a).toFixed(1)} ms :: ${a.map((v) => v.toFixed(0)).join(",")}`);
    // eslint-disable-next-line no-console
    console.log(`[PERF] 1 path  x${N}: median ${med(b).toFixed(1)} ms :: ${b.map((v) => v.toFixed(0)).join(",")}`);
    // eslint-disable-next-line no-console
    console.log(`[PERF] delta ${(med(b) - med(a)).toFixed(1)} ms (${(((med(b) - med(a)) / med(a)) * 100).toFixed(1)}%)`);
    expect(N).toBe(200);
  }, 180000);
});
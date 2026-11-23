// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { RingProgress } from "./RingProgress";

const arc = (ring: HTMLElement, index = 0) =>
  ring.querySelector("svg")!.querySelectorAll("circle")[index + 1] as SVGCircleElement;

describe("RingProgress", () => {
  test("exposes determinate progress semantics and clamps the reported value", () => {
    render(() => (
      <>
        <RingProgress value={42} data-testid="mid" />
        <RingProgress value={140} data-testid="high" />
        <RingProgress value={-20} data-testid="low" />
      </>
    ));

    for (const [id, value] of [["mid", "42"], ["high", "100"], ["low", "0"]] as const) {
      const ring = screen.getByTestId(id);
      expect(ring).toHaveAttribute("role", "progressbar");
      expect(ring).toHaveAttribute("aria-valuemin", "0");
      expect(ring).toHaveAttribute("aria-valuemax", "100");
      expect(ring).toHaveAttribute("aria-valuenow", value);
    }
  });

  test("draws the arc as a share of the circumference with a 12 o'clock start", () => {
    render(() => <RingProgress value={25} size={100} thickness={8} data-testid="ring" />);

    const ring = screen.getByTestId("ring");
    const progressArc = arc(ring);
    const circumference = 2 * Math.PI * Number(progressArc.getAttribute("r"));
    const [arcLength, dashLength] = (progressArc.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);

    expect(arcLength).toBeCloseTo(circumference * 0.25, 2);
    expect(dashLength).toBeCloseTo(circumference, 2);
    expect(progressArc.getAttribute("stroke-dashoffset")).toBe("0");
    expect(progressArc.getAttribute("transform")).toBe("rotate(-90 50 50)");
  });

  test("stacks sections into consecutive arcs and reports their total", () => {
    render(() => (
      <RingProgress
        size={100}
        thickness={8}
        sections={[{ value: 60, color: "success" }, { value: 40, color: "warning" }]}
        data-testid="ring"
      />
    ));

    const ring = screen.getByTestId("ring");
    expect(ring).toHaveAttribute("aria-valuenow", "100");
    const first = arc(ring, 0);
    const second = arc(ring, 1);
    const circumference = 2 * Math.PI * Number(first.getAttribute("r"));
    expect(Number(first.getAttribute("stroke-dasharray").split(" ")[0])).toBeCloseTo(circumference * 0.6, 2);
    expect(Number(second.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * 0.6, 2);
    expect(first.getAttribute("stroke")).not.toBe(second.getAttribute("stroke"));
  });

  test("size, thickness, round caps and the centred label are rendered", () => {
    render(() => (
      <RingProgress value={70} size={120} thickness={10} roundCaps label="70%" data-testid="ring" />
    ));

    const ring = screen.getByTestId("ring");
    expect(ring.style.width).toBe("120px");
    expect(ring.style.height).toBe("120px");
    const svg = ring.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("120");
    expect(svg.getAttribute("viewBox")).toBe("0 0 120 120");
    expect(arc(ring).getAttribute("stroke-width")).toBe("10");
    expect(arc(ring).getAttribute("stroke-linecap")).toBe("round");
    expect(ring).toHaveTextContent("70%");
  });
});

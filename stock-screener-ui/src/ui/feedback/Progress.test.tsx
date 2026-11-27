// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Progress } from "./Progress";

/** Track, fill and label are the root's first three children in that order. */
function parts(testId: string) {
  const root = screen.getByTestId(testId);
  return {
    root,
    track: root.children[0] as HTMLElement,
    fill: root.children[1] as HTMLElement,
    label: root.children[2] as HTMLElement | undefined,
  };
}

describe("Progress", () => {
  test("sets aria-valuenow from value", () => {
    render(() => <Progress value={66} data-testid="pg" />);
    const pg = screen.getByTestId("pg");
    expect(pg).toHaveAttribute("aria-valuenow", "66");
  });

  test("every progressbar has an accessible name", () => {
    render(() => <Progress value={66} data-testid="pg" />);
    expect(screen.getByTestId("pg")).toHaveAttribute("aria-label", "Progress");
    render(() => <Progress value={65} label="Upload" sections={[{ value: 100, color: "info" }]} data-testid="pg2" />);
    expect(screen.getByTestId("pg2")).toHaveAttribute("aria-label", "Upload");
  });

  test("the absolute fill overlays a full-width track inside the relative root", () => {
    render(() => <Progress value={62} data-testid="pg" />);
    const { root, track, fill } = parts("pg");
    expect(root.className).toContain("relative");
    expect(root.className).toContain("w-full");
    expect(track.className).toContain("w-full");
    expect(track.style.width).toBe("");
    expect(fill.className).toContain("absolute");
    expect(fill.className).toContain("top-0");
    expect(fill.className).toContain("left-0");
    expect(fill.style.height).toBe(track.style.height);
  });

  test.each([0, 25, 62, 100])("paints the determinate fill at %i% width", (value) => {
    render(() => <Progress value={value} data-testid={`pg-${value}`} />);
    const { root, fill } = parts(`pg-${value}`);
    expect(fill.style.width).toBe(`${value}%`);
    expect(root).toHaveAttribute("aria-valuenow", String(value));
    expect(fill.className).toContain("absolute");
  });

  test("clamps out-of-range values so the fill never escapes the track", () => {
    render(() => <Progress value={-20} data-testid="pg-low" />);
    render(() => <Progress value={140} data-testid="pg-high" />);
    expect(parts("pg-low").fill.style.width).toBe("0%");
    expect(parts("pg-low").root).toHaveAttribute("aria-valuenow", "0");
    expect(parts("pg-high").fill.style.width).toBe("100%");
    expect(parts("pg-high").root).toHaveAttribute("aria-valuenow", "100");
  });

  test("keeps the label centred over track and fill", () => {
    render(() => <Progress value={62} label="Upload" data-testid="pg" />);
    const { track, fill, label } = parts("pg");
    expect(label?.className).toContain("absolute inset-0");
    expect(label).toHaveTextContent("Upload");
    expect(fill.style.width).toBe("62%");
    expect(fill.style.height).toBe(track.style.height);
  });

  test("renders section bars in flow with their own widths", () => {
    render(() => (
      <Progress value={65} sections={[{ value: 40, color: "info" }, { value: 25, color: "warning" }]} data-testid="pg2" />));
    const bars = Array.from(screen.getByTestId("pg2").querySelectorAll("div")) as HTMLElement[];
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.style.width)).toEqual(["40%", "25%"]);
    for (const bar of bars) {
      expect(bar.className).not.toContain("absolute");
      expect(bar.style.height).toBe("100%");
    }
  });
});

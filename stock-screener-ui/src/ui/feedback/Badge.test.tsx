// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Badge } from "./Badge";
import { Chip } from "../inputs/Chip";
import { SegmentedControl } from "../inputs/SegmentedControl";

describe("Badge — status label", () => {
  test("renders children and exposes testid", () => {
    render(() => <Badge data-testid="b">+2.4%</Badge>);
    expect(screen.getByTestId("b").textContent).toBe("+2.4%");
  });

  test("filled success badge renders", () => {
    render(() => <Badge variant="filled" color="success" data-testid="b2">up</Badge>);
    expect(screen.getByTestId("b2").textContent).toBe("up");
  });

  test("leftSection and rightSection render", () => {
    render(() => (
      <Badge leftSection={<span>↑</span>} color="success" data-testid="b3">
        +2.4%
      </Badge>));
    expect(screen.getByTestId("b3").textContent).toContain("↑");
    expect(screen.getByTestId("b3").textContent).toContain("+2.4%");
  });

  test("calls onClick", () => {
    const onClick = vi.fn();
    render(() => <Badge onClick={onClick} data-testid="b4">click</Badge>);
    fireEvent.click(screen.getByTestId("b4"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Badge — shape language", () => {
  test("is a 16px rounded rectangle with uppercase 9px tracked text", () => {
    render(() => <Badge data-testid="s1">live</Badge>);
    const el = screen.getByTestId("s1");
    expect(el.style.height).toBe("16px");
    expect(el.style.borderRadius).toBe("4px");
    expect(el.style.fontSize).toBe("9px");
    expect(el.className).toContain("tracking-[0.04em]");
    expect(el.style.fontWeight).toBe("600");
    expect(el.className).toContain("uppercase");
  });

  test("light and filled carry no visible border", () => {
    render(() => (
      <>
        <Badge variant="light" data-testid="s2">light</Badge>
        <Badge variant="filled" data-testid="s3">filled</Badge>
      </>
    ));
    expect(screen.getByTestId("s2").style.borderStyle).toBe("none");
    expect(screen.getByTestId("s3").style.borderStyle).toBe("none");
  });

  test("outline adds a hairline of the tone colour", () => {
    render(() => <Badge variant="outline" color="success" data-testid="s4">ok</Badge>);
    expect(screen.getByTestId("s4").style.borderWidth).toBe("1px");
    expect(screen.getByTestId("s4").style.borderStyle).toBe("solid");
  });

  test("never advertises itself as clickable", () => {
    render(() => <Badge data-testid="s5">label</Badge>);
    const el = screen.getByTestId("s5");
    expect(el.style.cursor).toBe("default");
    expect(el.className).not.toContain("hover:");
    expect(el.tagName).toBe("SPAN");
  });

  test("dot variant is transparent with no pill chrome and renders the dot", () => {
    render(() => <Badge variant="dot" color="info" data-testid="s6">dot</Badge>);
    const el = screen.getByTestId("s6");
    expect(el.style.backgroundColor).toBe("transparent");
    expect(el.style.borderWidth).toBe("0px");
    expect(el.style.borderRadius).toBe("0px");
    const dot = el.querySelector("span[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.backgroundColor).toBe("#4A8FD8");
  });
});

describe("Badge / Chip / SegmentedControl — distinct shapes", () => {
  test("heights are ordered Badge 16 < Chip 20 < SegmentedControl item 24", () => {
    render(() => (
      <>
        <Badge data-testid="shape-badge">b</Badge>
        <Chip data-testid="shape-chip">c</Chip>
        <SegmentedControl data={["a", "b"]} data-testid="shape-seg" />
      </>
    ));
    const badge = parseInt(screen.getByTestId("shape-badge").style.height, 10);
    const chip = parseInt(screen.getByTestId("shape-chip").style.height, 10);
    const item = parseInt(
      (screen.getByTestId("shape-seg").querySelector("button") as HTMLButtonElement).style.height,
      10,
    );
    expect(badge).toBe(16);
    expect(chip).toBe(20);
    expect(item).toBe(24);
    expect(new Set([badge, chip, item]).size).toBe(3);
  });

  test("badge and chip share the 4px radius but the segmented track is 6px", () => {
    render(() => (
      <>
        <Badge data-testid="rad-badge">b</Badge>
        <Chip data-testid="rad-chip">c</Chip>
        <SegmentedControl data={["a"]} data-testid="rad-seg" />
      </>
    ));
    expect(screen.getByTestId("rad-badge").style.borderRadius).toBe("4px");
    expect(screen.getByTestId("rad-chip").style.borderRadius).toBe("4px");
    expect(screen.getByTestId("rad-seg").style.borderRadius).toBe("6px");
  });

  test("only the chip is clickable", () => {
    render(() => (
      <>
        <Badge data-testid="cur-badge">b</Badge>
        <Chip data-testid="cur-chip">c</Chip>
        <SegmentedControl data={["a"]} data-testid="cur-seg" />
      </>
    ));
    expect(screen.getByTestId("cur-badge").style.cursor).toBe("default");
    expect(screen.getByTestId("cur-chip").style.cursor).toBe("pointer");
    const segItem = screen.getByTestId("cur-seg").querySelector("button") as HTMLButtonElement;
    expect(segItem.className).toContain("cursor-pointer");
  });
});

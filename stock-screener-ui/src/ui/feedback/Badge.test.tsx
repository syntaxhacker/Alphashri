// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import {
  BADGE_TONE_SUFFIXES,
  BADGE_TOKEN_NAMES,
  UI_TONES,
  badgeTone,
  componentTokenProperty,
} from "../componentTokens";
import * as palette from "../palette";
import { pickTextColor } from "@/utils/contrast";
import { typeSize } from "../typography";
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

  test("filled badge foreground is the theme var, not a fixed hex", () => {
    render(() => <Badge variant="filled" color="error" data-testid="fb">SL</Badge>);
    expect(screen.getByTestId("fb").style.color).toBe("var(--ui-badge-filled-ink)");
  });

  test("filled badge background is a component token, never a raw anchor", () => {
    render(() => (
      <>
        <Badge variant="filled" color="success" data-testid="fs">up</Badge>
        <Badge variant="filled" color="error" data-testid="fe">SL</Badge>
        <Badge variant="filled" color="warning" data-testid="fw">WAIT</Badge>
        <Badge variant="filled" color="info" data-testid="fi">NEW</Badge>
        <Badge variant="filled" color="primary" data-testid="fp">LIVE</Badge>
      </>
    ));
    expect(screen.getByTestId("fs").style.backgroundColor).toBe("var(--ui-badge-positive-main)");
    expect(screen.getByTestId("fe").style.backgroundColor).toBe("var(--ui-badge-negative-main)");
    expect(screen.getByTestId("fw").style.backgroundColor).toBe("var(--ui-badge-warning-main)");
    expect(screen.getByTestId("fi").style.backgroundColor).toBe("var(--ui-badge-info-main)");
    expect(screen.getByTestId("fp").style.backgroundColor).toBe("var(--ui-badge-primary-main)");
    // Paint must go through the token tier so the tone stays a single source.
    for (const id of ["fs", "fe", "fw", "fi", "fp"]) {
      expect(screen.getByTestId(id).style.backgroundColor).not.toContain("#");
    }
  });

  test("outline keeps the tone token and light uses its wash token", () => {
    render(() => (
      <>
        <Badge variant="outline" color="success" data-testid="os">ok</Badge>
        <Badge variant="light" color="success" data-testid="ls">ok</Badge>
      </>
    ));
    expect(screen.getByTestId("os").style.backgroundColor).toBe("transparent");
    expect(screen.getByTestId("os").style.borderColor).toBe("var(--ui-badge-positive-main)");
    expect(screen.getByTestId("ls").style.backgroundColor).toBe("var(--ui-badge-positive-wash)");
    expect(screen.getByTestId("ls").style.color).toBe("var(--ui-badge-positive-main)");
  });

  test("non-filled badge foreground stays the tone colour", () => {
    render(() => <Badge variant="outline" color="success" data-testid="nb">ok</Badge>);
    expect(screen.getByTestId("nb").style.color).toBe("var(--ui-badge-positive-main)");
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

  test("a raw fill colour gets a contrast-picked ink", () => {
    render(() => <Badge variant="filled" color={palette.PRIMARY} data-testid="b-raw">raw</Badge>);
    const el = screen.getByTestId("b-raw");
    expect(el.style.backgroundColor).toBe(palette.PRIMARY);
    expect(el.style.color).toBe(pickTextColor(palette.PRIMARY, palette.TEXT, palette.BG));
  });
});

describe("Badge — shape language", () => {
  test("is a 16px rounded rectangle with uppercase micro-token tracked text", () => {
    render(() => <Badge data-testid="s1">live</Badge>);
    const el = screen.getByTestId("s1");
    expect(el.style.height).toBe("16px");
    expect(el.style.borderRadius).toBe("4px");
    expect(el.style.fontSize).toBe(`${typeSize("micro")}px`);
    expect(el.className).toContain("tracking-[0.04em]");
    expect(el.style.fontWeight).toBe("600");
    expect(el.className).toContain("uppercase");
  });

  test("every size paints its label from the shared micro token, not a private px size", () => {
    render(() => <Badge size="md" data-testid="s-md">md</Badge>);
    expect(screen.getByTestId("s-md").style.fontSize).toBe(`${typeSize("micro")}px`);
    const src = readFileSync(resolve(process.cwd(), "src/ui/feedback/Badge.tsx"), "utf8");
    expect(src).toContain("typeSize(");
    expect(src).not.toMatch(/"font-size":\s*"?\d+(?:\.\d+)?px/);
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
    expect((dot as HTMLElement).style.backgroundColor).toBe("var(--ui-badge-info-main)");
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

describe("Badge — component token tier", () => {
  const css = readFileSync(resolve(process.cwd(), "src/tailwind.css"), "utf8");

  test("declares every badge token in tailwind.css", () => {
    const missing = BADGE_TOKEN_NAMES.filter((name) => !css.includes(`${componentTokenProperty(name)}:`));
    expect(missing).toEqual([]);
  });

  test("maps every colour alias and every tone to a declared token", () => {
    for (const color of [
      "primary", "success", "error", "danger", "warning", "info",
      "secondary", "default", "neutral", "dimmed", "unmapped", undefined,
    ]) {
      const tone = badgeTone(color);
      expect(UI_TONES, String(color)).toContain(tone);
      for (const suffix of BADGE_TONE_SUFFIXES) {
        const name = `ui-badge-${tone}-${suffix}`;
        expect(BADGE_TOKEN_NAMES, name).toContain(name);
        expect(css, name).toContain(`${componentTokenProperty(name as (typeof BADGE_TOKEN_NAMES)[number])}:`);
      }
    }
  });

  test("every variant paints from a token (filled / light / outline / dot / white / unset)", () => {
    for (const variant of ["filled", "light", "outline", "dot", "white", undefined] as const) {
      const { container } = render(() => <Badge variant={variant} color="success" data-testid={`v-${variant}`}>v</Badge>);
      const style = (container.firstElementChild as HTMLElement).getAttribute("style") ?? "";
      expect(style, String(variant)).toMatch(/var\(--ui-badge-/);
    }
  });

  test("every size keeps its own box metrics while the colour stays tokenised", () => {
    const boxes: Record<string, string> = {
      xs: "14px", sm: "16px", md: "18px", lg: "20px", xl: "22px",
    };
    for (const [size, height] of Object.entries(boxes)) {
      render(() => <Badge size={size as "sm"} variant="filled" color="error" data-testid={`sz-${size}`}>s</Badge>);
      const el = screen.getByTestId(`sz-${size}`);
      expect(el.style.height, size).toBe(height);
      expect(el.style.fontSize, size).toBe(`${typeSize("micro")}px`);
      expect(el.style.backgroundColor, size).toBe("var(--ui-badge-negative-main)");
    }
  });

  test("raw caller fills still get their ink from pickTextColor", () => {
    for (const color of [palette.PRIMARY, palette.WARNING, "rgb(12, 34, 56)"]) {
      const { container } = render(() => <Badge variant="filled" color={color}>raw</Badge>);
      const el = container.firstElementChild as HTMLElement;
      expect(el.style.backgroundColor).toBe(color);
      expect(el.style.color).toBe(pickTextColor(color, palette.TEXT, palette.BG));
    }
  });
});

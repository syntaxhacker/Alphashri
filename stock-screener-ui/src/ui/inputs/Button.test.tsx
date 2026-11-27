// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import {
  BUTTON_TONE_SUFFIXES,
  BUTTON_TOKEN_NAMES,
  UI_TONES,
  buttonTone,
  componentTokenProperty,
} from "../componentTokens";
import { Button } from "./Button";
import type { UIButtonProps } from "../types";

const VARIANTS: NonNullable<UIButtonProps["variant"]>[] = [
  "filled",
  "light",
  "outline",
  "subtle",
  "default",
];

const classSet = (variant: UIButtonProps["variant"]): Set<string> => {
  const { container } = render(() => <Button variant={variant}>{variant}</Button>);
  const el = container.firstElementChild as HTMLElement;
  return new Set(el.className.split(" ").filter(Boolean));
};

describe("Button — variants are distinct treatments", () => {
  it("renders five variants as five different class sets", () => {
    const sets = VARIANTS.map((v) => ({ variant: v, set: classSet(v) }));

    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i];
        const b = sets[j];
        const same =
          a.set.size === b.set.size && [...a.set].every((c) => b.set.has(c));
        expect(same, `${a.variant} and ${b.variant} render the same classes`).toBe(false);
      }
    }
  });

  it("differs by treatment, not only by colour", () => {
    const filled = classSet("filled");
    const light = classSet("light");
    const outline = classSet("outline");
    const subtle = classSet("subtle");
    const neutral = classSet("default");

    // filled: solid fill, no visible border, heavier weight
    expect(filled).toContain("bg-[var(--ui-button-primary-bg)]");
    expect(filled).toContain("border-transparent");
    expect(filled).toContain("font-semibold");

    // light: 12% accent wash, still no visible border
    expect(light).toContain("bg-[var(--ui-button-primary-wash)]");
    expect(light).toContain("border-transparent");
    expect(light).not.toContain("bg-[var(--ui-button-primary-bg)]");

    // outline: hairline, no fill
    expect(outline).toContain("border-[var(--ui-button-neutral-border)]");
    expect(outline).toContain("bg-transparent");
    expect(outline).not.toContain("bg-[var(--ui-button-primary-bg)]");

    // subtle: fully flat, hover-only wash
    expect(subtle).toContain("bg-transparent");
    expect(subtle).toContain("border-transparent");
    expect(subtle).toContain("text-[var(--ui-button-neutral-muted)]");

    // default: neutral filled + hairline (a form button, not a CTA)
    expect(neutral).toContain("bg-[var(--ui-button-neutral-surface-alt)]");
    expect(neutral).toContain("border-[var(--ui-button-neutral-border)]");
    expect(neutral).not.toContain("bg-[var(--ui-button-primary-bg)]");
  });

  it("shifts the whole treatment — not just the text — for color=error", () => {
    const { container } = render(() => (
      <Button variant="filled" color="error">
        Delete
      </Button>
    ));
    const cls = container.firstElementChild as HTMLElement;
    expect(cls.className).toContain("bg-[var(--ui-button-negative-bg)]");
    expect(cls.className).not.toContain("bg-[var(--ui-button-primary-bg)]");

    const outlined = render(() => (
      <Button variant="outline" color="error">
        Cancel
      </Button>
    ));
    const out = outlined.container.firstElementChild as HTMLElement;
    expect(out.className).toContain("border-[var(--ui-button-negative-text)]");
    expect(out.className).toContain("text-[var(--ui-button-negative-text)]");

    const tinted = render(() => (
      <Button variant="light" color="error">
        Danger
      </Button>
    ));
    expect((tinted.container.firstElementChild as HTMLElement).className).toContain("bg-[var(--ui-button-negative-wash)]");
  });

  it("keeps outline and default neutral when no color is given", () => {
    expect(classSet("outline")).toContain("border-[var(--ui-button-neutral-border)]");
    expect(classSet("outline")).not.toContain("text-[var(--ui-button-primary-text)]");
    expect(classSet("default")).not.toContain("border-[var(--ui-button-primary-text)]");
  });

  it("keeps an explicit transparent control out of the boxed height map", () => {
    const { container } = render(() => (
      <Button variant="transparent" style={{ "padding-top": "0" }}>
        inline
      </Button>
    ));
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).not.toMatch(/(^|\s)h-\[/);
    expect(cls).toContain("text-sm");
  });

  it("treats an omitted variant as the primary action (filled)", () => {
    const enabled = classSet(undefined);
    const filled = classSet("filled");
    expect([...enabled].sort()).toEqual([...filled].sort());
  });
});

describe("Button — one height per size", () => {
  const HEIGHTS: Array<[NonNullable<UIButtonProps["size"]>, string]> = [
    ["xs", "h-[24px]"],
    ["sm", "h-[30px]"],
    ["md", "h-[34px]"],
    ["lg", "h-[38px]"],
    ["xl", "h-[42px]"],
  ];

  it.each(HEIGHTS)("size=%s fixes the height at %s", (size, heightClass) => {
    render(() => <Button size={size}>x</Button>);
    expect(screen.getByRole("button", { name: "x" }).className).toContain(heightClass);
  });

  it("every variant at one size carries the same height class", () => {
    for (const variant of VARIANTS) {
      const { container } = render(() => (
        <Button variant={variant} size="sm">
          {variant}
        </Button>
      ));
      expect((container.firstElementChild as HTMLElement).className).toContain("h-[30px]");
    }
  });

  it("defaults to the sm step", () => {
    render(() => <Button>default size</Button>);
    expect(screen.getByRole("button", { name: "default size" }).className).toContain("h-[30px]");
  });
});

describe("Button — shape and disabled", () => {
  it("uses a 6px radius by default", () => {
    render(() => <Button>radius</Button>);
    expect(screen.getByRole("button", { name: "radius" }).className).toContain("rounded-[6px]");
  });

  it("honours an explicit numeric radius through inline style", () => {
    render(() => <Button radius={10}>r10</Button>);
    const btn = screen.getByRole("button", { name: "r10" });
    expect(btn.style.borderRadius).toBe("10px");
    expect(btn.className).not.toContain("rounded-[6px]");
  });

  it("looks inert in every variant: 45% opacity + not-allowed cursor", () => {
    for (const variant of VARIANTS) {
      const { container } = render(() => (
        <Button variant={variant} disabled>
          {variant}
        </Button>
      ));
      const btn = container.firstElementChild as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.className).toContain("disabled:opacity-[0.45]");
      expect(btn.className).toContain("disabled:cursor-not-allowed");
      // Hover states are gated behind `enabled:` so a disabled control cannot paint them.
      expect(btn.className).not.toMatch(/(^|\s)hover:/);
    }
  });

  it("treats loading as disabled", () => {
    render(() => <Button loading>saving</Button>);
    const btn = screen.getByRole("button", { name: "saving" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("Button — behaviour preserved", () => {
  it("fires onClick and forwards data-testid unchanged", () => {
    const onClick = vi.fn();
    render(() => (
      <Button data-testid="save-btn" onClick={onClick}>
        Save
      </Button>
    ));
    const btn = screen.getByTestId("save-btn");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while disabled", () => {
    const onClick = vi.fn();
    render(() => (
      <Button disabled onClick={onClick}>
        Save
      </Button>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("re-reads variant and size reactively", () => {
    const [variant, setVariant] = createSignal<UIButtonProps["variant"]>("filled");
    const [size, setSize] = createSignal<NonNullable<UIButtonProps["size"]>>("xs");
    render(() => (
      <Button variant={variant()} size={size()}>
        live
      </Button>
    ));
    const btn = screen.getByRole("button", { name: "live" });
    expect(btn.className).toContain("bg-[var(--ui-button-primary-bg)]");
    expect(btn.className).toContain("h-[24px]");

    setVariant("subtle");
    setSize("lg");
    const tokens = new Set(btn.className.split(" "));
    expect(tokens.has("bg-[var(--ui-button-primary-bg)]")).toBe(false);
    expect(btn.className).toContain("text-[var(--ui-button-neutral-muted)]");
    expect(btn.className).toContain("h-[38px]");
  });

  it("renders left and right sections", () => {
    render(() => (
      <Button leftSection={<span data-testid="l" />} rightSection={<span data-testid="r" />}>
        both
      </Button>
    ));
    expect(screen.getByTestId("l")).toBeInTheDocument();
    expect(screen.getByTestId("r")).toBeInTheDocument();
  });
});

describe("Button — component token tier", () => {
  const css = readFileSync(resolve(process.cwd(), "src/tailwind.css"), "utf8");

  it("declares every button token in tailwind.css", () => {
    const missing = BUTTON_TOKEN_NAMES.filter((name) => !css.includes(`${componentTokenProperty(name)}:`));
    expect(missing).toEqual([]);
  });

  it("maps every colour alias used by Button to a declared tone token", () => {
    const colors: Array<UIButtonProps["color"]> = [
      "primary", "success", "error", "danger", "warning", "info", "secondary", "unmapped", undefined,
    ];
    for (const color of colors) {
      const tone = buttonTone(color);
      expect(UI_TONES, String(color)).toContain(tone);
      for (const suffix of BUTTON_TONE_SUFFIXES) {
        const name = `ui-button-${tone}-${suffix}`;
        expect(BUTTON_TOKEN_NAMES, name).toContain(name);
        expect(css, name).toContain(`${componentTokenProperty(name as (typeof BUTTON_TOKEN_NAMES)[number])}:`);
      }
    }
  });

  it("every variant reads a component token, not a re-derived palette value", () => {
    const variants: Array<UIButtonProps["variant"]> = [...VARIANTS, "white", "transparent", undefined];
    for (const variant of variants) {
      const { container } = render(() => <Button variant={variant}>{String(variant)}</Button>);
      const cls = (container.firstElementChild as HTMLElement).className;
      expect(cls, String(variant)).toMatch(/var\(--ui-button-/);
    }
  });

  it("keeps the five size height steps while colour stays tokenised", () => {
    const heights: Record<NonNullable<UIButtonProps["size"]>, string> = {
      xs: "h-[24px]", sm: "h-[30px]", md: "h-[34px]", lg: "h-[38px]", xl: "h-[42px]",
    };
    for (const size of Object.keys(heights) as Array<NonNullable<UIButtonProps["size"]>>) {
      const { container } = render(() => <Button size={size} color="error">{size}</Button>);
      const cls = (container.firstElementChild as HTMLElement).className;
      expect(cls, size).toContain(heights[size]);
      expect(cls, size).toContain("bg-[var(--ui-button-negative-bg)]");
    }
  });
});

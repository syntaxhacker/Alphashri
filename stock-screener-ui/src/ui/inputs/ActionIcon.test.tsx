// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ActionIcon } from "./ActionIcon";
import { Button } from "./Button";
import type { UIActionIconProps } from "../types";

const Icon = () => <span data-testid="glyph">x</span>;

const classSet = (variant: UIActionIconProps["variant"]): Set<string> => {
  const { container } = render(() => (
    <ActionIcon variant={variant} aria-label={String(variant)}>
      <Icon />
    </ActionIcon>
  ));
  return new Set((container.firstElementChild as HTMLElement).className.split(" ").filter(Boolean));
};

describe("ActionIcon — icon control, not a small Button", () => {
  it("is a square on the button height scale", () => {
    const steps: Array<[NonNullable<UIActionIconProps["size"]>, string]> = [
      ["xs", "w-[24px] h-[24px]"],
      ["sm", "w-[30px] h-[30px]"],
      ["md", "w-[34px] h-[34px]"],
      ["lg", "w-[38px] h-[38px]"],
      ["xl", "w-[42px] h-[42px]"],
    ];
    for (const [size, classes] of steps) {
      const { container } = render(() => (
        <ActionIcon size={size} aria-label={size}>
          <Icon />
        </ActionIcon>
      ));
      const cls = (container.firstElementChild as HTMLElement).className;
      for (const c of classes.split(" ")) expect(cls).toContain(c);
    }
  });

  it("defaults to the xs step and has no text padding", () => {
    const { container } = render(() => (
      <ActionIcon aria-label="default">
        <Icon />
      </ActionIcon>
    ));
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("w-[24px]");
    expect(cls).toContain("h-[24px]");
    expect(cls).toContain("p-0");
  });

  it("takes a numeric size as an explicit square", () => {
    const { container } = render(() => (
      <ActionIcon size={20} aria-label="num">
        <Icon />
      </ActionIcon>
    ));
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("20px");
    expect(el.style.height).toBe("20px");
    // The named-step square classes must not fight the explicit size.
    expect(el.className).not.toContain("w-[24px]");
  });

  it("uses the 6px web-app radius", () => {
    const { container } = render(() => (
      <ActionIcon aria-label="r">
        <Icon />
      </ActionIcon>
    ));
    expect((container.firstElementChild as HTMLElement).className).toContain("rounded-[6px]");
  });

  it("hovers as a raised rounded square, unlike Button's treatment", () => {
    const subtle = classSet("subtle");
    expect(subtle).toContain("enabled:hover:bg-fin-surface-alt");
    expect(subtle).toContain("enabled:hover:border-fin-border");

    // Button's subtle hover is an accent wash; ActionIcon's is a neutral square.
    const { container } = render(() => <Button variant="subtle">text</Button>);
    const buttonCls = (container.firstElementChild as HTMLElement).className;
    expect(buttonCls).toContain("enabled:hover:bg-fin-primary/12");
    expect(buttonCls).not.toContain("enabled:hover:border-fin-border");
  });

  it("keeps filled, light, outline, default and subtle/transparent distinct", () => {
    const variants: NonNullable<UIActionIconProps["variant"]>[] = [
      "filled",
      "light",
      "outline",
      "default",
      "subtle",
      "transparent",
    ];
    const sets = variants.map((v) => ({ variant: v, set: classSet(v) }));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i];
        const b = sets[j];
        if (a.variant === "subtle" && b.variant === "transparent") continue; // documented alias
        const same = a.set.size === b.set.size && [...a.set].every((c) => b.set.has(c));
        expect(same, `${a.variant} and ${b.variant} render the same classes`).toBe(false);
      }
    }
  });

  it("shifts the whole treatment for color=error", () => {
    const { container } = render(() => (
      <ActionIcon variant="filled" color="error" aria-label="delete">
        <Icon />
      </ActionIcon>
    ));
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("bg-fin-negative");
    expect(cls).not.toContain("bg-fin-primary");
  });

  it("outline uses the neutral hairline unless a color is given", () => {
    const plain = classSet("outline");
    expect(plain).toContain("border-fin-border");
    expect(plain).toContain("bg-transparent");

    const { container } = render(() => (
      <ActionIcon variant="outline" color="error" aria-label="err">
        <Icon />
      </ActionIcon>
    ));
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("border-fin-negative");
    expect(new Set(cls.split(" ")).has("border-fin-border")).toBe(false);
  });

  it("looks inert when disabled: 45% opacity + not-allowed", () => {
    const { container } = render(() => (
      <ActionIcon disabled aria-label="off">
        <Icon />
      </ActionIcon>
    ));
    const el = container.firstElementChild as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.className).toContain("disabled:opacity-[0.45]");
    expect(el.className).toContain("disabled:cursor-not-allowed");
    expect(el.className).not.toMatch(/(^|\s)hover:/);
  });

  it("fires onClick and keeps its data-testid", () => {
    const onClick = vi.fn();
    render(() => (
      <ActionIcon data-testid="icon-btn" onClick={onClick} aria-label="go">
        <Icon />
      </ActionIcon>
    ));
    fireEvent.click(screen.getByTestId("icon-btn"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("re-reads variant and color reactively", () => {
    const [variant, setVariant] = createSignal<UIActionIconProps["variant"]>("filled");
    const [color, setColor] = createSignal<UIActionIconProps["color"]>("primary");
    render(() => (
      <ActionIcon variant={variant()} color={color()} aria-label="live">
        <Icon />
      </ActionIcon>
    ));
    const el = screen.getByRole("button", { name: "live" });
    expect(el.className).toContain("bg-fin-primary");

    setVariant("outline");
    setColor("error");
    expect(el.className).not.toContain("bg-fin-primary");
    expect(el.className).toContain("border-fin-negative");
  });

  it("replaces children with a spinner while loading", () => {
    render(() => (
      <ActionIcon loading aria-label="busy">
        <Icon />
      </ActionIcon>
    ));
    const el = screen.getByRole("button", { name: "busy" });
    expect(el).toBeDisabled();
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("glyph")).toBeNull();
  });
});

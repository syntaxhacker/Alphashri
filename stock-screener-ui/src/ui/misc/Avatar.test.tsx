// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { TYPE_SCALE, typeSize } from "../typography";
import type { UIAvatarProps } from "../types";
import { Avatar } from "./Avatar";

const text = (id: string) => screen.getByTestId(id).textContent;

describe("Avatar", () => {
  test("derives up to two upper-case initials from alt text", () => {
    render(() => (
      <>
        <Avatar alt="Ada Lovelace" data-testid="two" />
        <Avatar alt="Ada Marie Lovelace" data-testid="three" />
        <Avatar alt="ada" data-testid="one" />
        <Avatar data-testid="none" />
      </>
    ));

    expect(text("two")).toBe("AL");
    expect(text("three")).toBe("AM");
    expect(text("one")).toBe("A");
    expect(text("none")).toBe("?");
  });

  test("children win over alt initials, and a src renders the image instead", () => {
    render(() => (
      <>
        <Avatar alt="Ada Lovelace" data-testid="child">AS</Avatar>
        <Avatar src="/avatar.png" alt="Ada Lovelace" data-testid="image" />
      </>
    ));

    expect(text("child")).toBe("AS");
    const image = screen.getByTestId("image");
    expect(image.querySelector("img")).toHaveAttribute("src", "/avatar.png");
    expect(image.querySelector("img")).toHaveAttribute("alt", "Ada Lovelace");
    expect(text("image")).toBe("");
  });

  test("size steps, numbers and numeric strings set width, height and font size", () => {
    render(() => (
      <>
        <Avatar size="xs" data-testid="xs" />
        <Avatar size="lg" data-testid="lg" />
        <Avatar size={56} data-testid="num" />
        <Avatar size="32" data-testid="str" />
        <Avatar data-testid="default" />
      </>
    ));

    for (const [id, width, font] of [
      ["xs", "24px", `${typeSize("micro")}px`],
      ["lg", "48px", `${typeSize("heading")}px`],
      ["num", "56px", `${typeSize("display")}px`],
      ["str", "32px", `${typeSize("body")}px`],
      ["default", "40px", `${typeSize("title")}px`],
    ] as const) {
      const avatar = screen.getByTestId(id);
      expect(avatar.style.width, id).toBe(width);
      expect(avatar.style.height, id).toBe(width);
      expect(avatar.style.fontSize, id).toBe(font);
    }
  });

  test("the decorative monogram never leaves the shared ladder or the 12px floor", () => {
    const scale = Object.values(TYPE_SCALE).map((s) => s.size);
    const cases: Array<UIAvatarProps["size"]> = ["xs", "sm", "md", "lg", "xl", 1, 12, 24, 32, 56, 120, "40"];
    for (const size of cases) {
      const { container } = render(() => <Avatar size={size} />);
      const glyph = Number.parseFloat((container.firstElementChild as HTMLElement).style.fontSize);
      expect(scale, `size ${String(size)}`).toContain(glyph);
      expect(glyph, `size ${String(size)}`).toBeGreaterThanOrEqual(typeSize("micro"));
      cleanup();
    }
  });

  test("colour, radius and className produce the right surface classes", () => {
    render(() => (
      <>
        <Avatar color="primary" radius="xs" data-testid="primary" />
        <Avatar color="success" data-testid="success" />
        <Avatar color="not-a-token" data-testid="unknown" />
        <Avatar radius="xl" data-testid="xl" />
        <Avatar radius={8} className="custom" data-testid="custom" />
      </>
    ));

    const primary = screen.getByTestId("primary");
    expect(primary).toHaveClass("bg-fin-primary", "text-fin-bg", "rounded-[4px]");
    expect(screen.getByTestId("success")).toHaveClass("bg-fin-positive");
    expect(screen.getByTestId("unknown")).toHaveClass("bg-fin-surface", "text-fin-text");
    expect(screen.getByTestId("xl")).toHaveClass("rounded-[16px]");
    const custom = screen.getByTestId("custom");
    expect(custom).toHaveClass("rounded-[8px]", "custom");
  });
});

// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Box } from "./Box";

describe("Box", () => {
  test("renders a div by default, keeping children and identity props", () => {
    render(() => (
      <Box id="box" className="custom-box" data-testid="box">
        <span data-testid="child">body</span>
      </Box>
    ));

    const box = screen.getByTestId("box");
    expect(box.tagName).toBe("DIV");
    expect(box.id).toBe("box");
    expect(box).toHaveClass("custom-box");
    expect(box).toContainElement(screen.getByTestId("child"));
  });

  test("maps spacing, colour and sizing props to CSS", () => {
    render(() => (
      <Box
        data-testid="box"
        p="md"
        px="sm"
        mt={12}
        mx="lg"
        bg="#123456"
        c="white"
        maw="60%"
        gap="xs"
      />
    ));

    const box = screen.getByTestId("box");
    expect(box.style.paddingTop).toBe("16px");
    expect(box.style.paddingBottom).toBe("16px");
    expect(box.style.paddingLeft).toBe("8px");
    expect(box.style.paddingRight).toBe("8px");
    expect(box.style.marginTop).toBe("12px");
    expect(box.style.marginLeft).toBe("24px");
    expect(box.style.marginRight).toBe("24px");
    expect(box.style.backgroundColor).toBe("#123456");
    expect(box.style.color).toBe("white");
    expect(box.style.maxWidth).toBe("60%");
    expect(box.style.gap).toBe("4px");
  });

  test("spacing is a numeric 8pt step and gap wins when both are supplied", () => {
    render(() => (
      <>
        <Box data-testid="from-spacing" spacing={3} />
        <Box data-testid="from-gap" spacing={3} gap="sm" />
      </>
    ));

    expect(screen.getByTestId("from-spacing")).toHaveStyle("gap: 24px");
    expect(screen.getByTestId("from-gap")).toHaveStyle("gap: 8px");
  });

  test("adds px to numeric style lengths but leaves unitless values alone", () => {
    const width = 440;
    render(() => (
      <Box data-testid="box" style={{ width, opacity: 0.5, "z-index": 2, "line-height": 1.4 }} />
    ));

    const box = screen.getByTestId("box");
    expect(box.style.width).toBe("440px");
    expect(box.style.opacity).toBe("0.5");
    expect(box.style.zIndex).toBe("2");
    expect(box.style.lineHeight).toBe("1.4");
  });

  test("component selects a semantic element and forwards ARIA plus click handlers", () => {
    const onClick = vi.fn();
    render(() => (
      <Box
        component="button"
        data-testid="cta"
        role="button"
        aria-label="Run scan"
        onClick={onClick}
      >
        Go
      </Box>
    ));

    const cta = screen.getByTestId("cta");
    expect(cta.tagName).toBe("BUTTON");
    expect(cta).toHaveAttribute("aria-label", "Run scan");
    fireEvent.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

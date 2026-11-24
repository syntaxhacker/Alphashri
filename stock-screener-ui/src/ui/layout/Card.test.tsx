// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "./Card";

afterEach(cleanup);

describe("Card", () => {
  it("forwards caller style so a bordered/width-constrained card is not silently reset", () => {
    const { container } = render(() => (
      <Card style={{ border: "1px solid var(--color-fin-border)", width: "300px" }}>
        <span>content</span>
      </Card>
    ));
    const card = container.querySelector("article") as HTMLElement;
    expect(card.style.border).toContain("1px solid");
    expect(card.style.width).toBe("300px");
  });

  it("keeps its own spacing/radius style while merging caller style", () => {
    const { container } = render(() => (
      <Card p="md" radius="lg" style={{ "background-color": "var(--color-fin-surface-alt)" }}>
        <span>content</span>
      </Card>
    ));
    const card = container.querySelector("article") as HTMLElement;
    expect(card.style.padding).toBe("16px");
    expect(card.style.borderRadius).toBe("10px");
    expect(card.style.backgroundColor).toBe("var(--color-fin-surface-alt)");
  });

  it("accepts numeric and raw radius values like Paper", () => {
    const rawRadius = "var(--radius-fin)" as unknown as "xl";
    const { container } = render(() => (
      <>
        <Card data-testid="numeric" radius={8} />
        <Card data-testid="raw" radius={rawRadius} />
      </>
    ));
    const numeric = container.querySelector('[data-testid="numeric"]') as HTMLElement;
    const raw = container.querySelector('[data-testid="raw"]') as HTMLElement;
    expect(numeric.style.borderRadius).toBe("8px");
    expect(raw.style.borderRadius).toBe("var(--radius-fin)");
  });
});

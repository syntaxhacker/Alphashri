// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { Card } from "./Card";
import { Paper } from "./Paper";

describe("Paper", () => {
  it("renders a surface section with radius, spacing and semantic children", () => {
    render(() => (
      <Paper data-testid="paper" radius="lg" p="md" bg="var(--color-fin-surface-alt)" c="var(--color-fin-text)">
        <span data-testid="child">body</span>
      </Paper>
    ));

    const paper = screen.getByTestId("paper");
    expect(paper.tagName).toBe("SECTION");
    expect(paper).toHaveClass("bg-fin-surface");
    expect(paper.style.borderRadius).toBe("10px");
    expect(paper.style.padding).toBe("16px");
    expect(paper.style.backgroundColor).toBe("var(--color-fin-surface-alt)");
    expect(paper.style.color).toBe("var(--color-fin-text)");
    expect(paper).toContainElement(screen.getByTestId("child"));
  });

  it("uses named shadow utilities and paints raw CSS shadows inline", () => {
    render(() => (
      <>
        <Paper data-testid="named" shadow="md" />
        <Paper data-testid="raw" shadow="0 4px 12px rgba(0, 0, 0, 0.5)" />
      </>
    ));

    expect(screen.getByTestId("named")).toHaveClass("bg-fin-surface", "shadow-md");
    expect(screen.getByTestId("named").style.boxShadow).toBe("");
    expect(screen.getByTestId("raw").style.boxShadow).toContain("0 4px 12px");
    expect(screen.getByTestId("raw")).not.toHaveClass("shadow-md");
  });

  it("accepts numeric and raw radius values", () => {
    // The runtime accepts raw CSS radii; UIRadius only names the documented scale.
    const rawRadius = "var(--radius-fin)" as unknown as "xl";
    render(() => (
      <>
        <Paper data-testid="numeric" radius={8} />
        <Paper data-testid="raw" radius={rawRadius} />
      </>
    ));

    expect(screen.getByTestId("numeric").style.borderRadius).toBe("8px");
    expect(screen.getByTestId("raw").style.borderRadius).toBe("var(--radius-fin)");
  });

  it("shares one named radius scale with Card", () => {
    const steps = ["xs", "sm", "md", "lg", "xl"] as const;
    render(() => (
      <>
        {steps.map((step) => (
          <div>
            <Paper data-testid={`paper-${step}`} radius={step} />
            <Card data-testid={`card-${step}`} radius={step} />
          </div>
        ))}
      </>
    ));

    const paperSteps = steps.map((step) => screen.getByTestId(`paper-${step}`).style.borderRadius);
    const cardSteps = steps.map((step) => screen.getByTestId(`card-${step}`).style.borderRadius);
    expect(cardSteps).toEqual(paperSteps);
    expect(paperSteps).toEqual(["2px", "4px", "6px", "10px", "14px"]);
  });

  it("selects semantic elements through component and falls back to section", () => {
    render(() => (
      <>
        <Paper component="article" data-testid="article" />
        <Paper component="aside" data-testid="aside" />
        <Paper component="not-a-tag" data-testid="fallback" />
      </>
    ));

    expect(screen.getByTestId("article").tagName).toBe("ARTICLE");
    expect(screen.getByTestId("aside").tagName).toBe("ASIDE");
    expect(screen.getByTestId("fallback").tagName).toBe("SECTION");
    expect(screen.getByTestId("article")).not.toHaveAttribute("component");
  });

  it("forwards click handlers, ARIA props and caller class/style", () => {
    const onClick = vi.fn();
    render(() => (
      <Paper
        data-testid="paper"
        p="md"
        className="my-panel border border-fin-border"
        style={{ padding: "4px", "z-index": "3" }}
        role="button"
        aria-label="Open panel"
        onClick={onClick}
      />
    ));

    const paper = screen.getByTestId("paper");
    expect(paper).toHaveClass("my-panel", "border", "border-fin-border");
    // Caller style is merged last, so it wins over the spacing prop.
    expect(paper.style.padding).toBe("4px");
    expect(paper.style.zIndex).toBe("3");
    expect(paper).toHaveAttribute("aria-label", "Open panel");
    fireEvent.click(paper);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("honours the legacy testId alias", () => {
    render(() => <Paper testId="legacy-paper" />);

    expect(screen.getByTestId("legacy-paper").tagName).toBe("SECTION");
  });
});

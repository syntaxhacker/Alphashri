// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Title } from "./Title";
import * as palette from "@/ui/palette";

describe("Title", () => {
  it("defaults to an h3", () => {
    render(() => <Title data-testid="t">heading</Title>);
    expect(screen.getByTestId("t").tagName).toBe("H3");
  });

  it("renders the heading tag from order", () => {
    render(() => <Title data-testid="t1" order={1}>h1</Title>);
    expect(screen.getByTestId("t1").tagName).toBe("H1");
    render(() => <Title data-testid="t6" order={6}>h6</Title>);
    expect(screen.getByTestId("t6").tagName).toBe("H6");
  });

  it("applies tone color via c", () => {
    render(() => <Title data-testid="t" order={3} c="info">teal</Title>);
    expect(screen.getByTestId("t")).toHaveStyle(`color: ${palette.INFO}`);
  });

  it("applies size from the type scale", () => {
    render(() => <Title data-testid="t" order={2} size="xl">big</Title>);
    expect(screen.getByTestId("t")).toHaveStyle("font-size: 24px");
  });

  it("forwards title as a native tooltip attribute", () => {
    render(() => <Title data-testid="t" order={3} title="hover me">tip</Title>);
    expect(screen.getByTestId("t")).toHaveAttribute("title", "hover me");
  });
});

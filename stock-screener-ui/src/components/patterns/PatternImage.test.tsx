// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { PatternImage } from "./PatternImage";

function r(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => <UIProvider>{children}</UIProvider>,
  });
}

afterEach(() => cleanup());

describe("PatternImage", () => {
  test("renders the <img> when a URL exists", () => {
    r(
      <PatternImage
        patternId="falling_wedge"
        images={{ falling_wedge: "/api/chart-patterns/image/falling_wedge" }}
      />,
    );

    const img = screen.getByTestId("pattern-image-falling_wedge");
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/falling_wedge");
    expect(screen.queryByTestId("pattern-image-placeholder")).toBeNull();
  });

  test("renders the placeholder when no image exists", () => {
    r(<PatternImage patternId="falling_wedge" images={{}} />);

    expect(screen.getByTestId("pattern-image-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-image-placeholder-label")).toHaveTextContent(
      "Falling Wedge",
    );
    expect(screen.queryByTestId("pattern-image-falling_wedge")).toBeNull();
  });

  test("falls back to the placeholder when the image fails to load", () => {
    r(<PatternImage patternId="falling_wedge" images={{ falling_wedge: "/broken" }} />);

    fireEvent.error(screen.getByTestId("pattern-image-falling_wedge"));

    expect(screen.getByTestId("pattern-image-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("pattern-image-falling_wedge")).toBeNull();
  });

  test("uses the raw id as the label for unknown patterns", () => {
    r(<PatternImage patternId="mystery_shape" images={{}} />);
    expect(screen.getByTestId("pattern-image-placeholder-label")).toHaveTextContent(
      "mystery_shape",
    );
  });
});

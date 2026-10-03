// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { QualityBadge } from "./QualityBadge";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("QualityBadge", () => {
  afterEach(() => cleanup());

  test("renders the tier label", () => {
    r(<QualityBadge quality="textbook" />);
    expect(screen.getByTestId("patterns-quality-textbook")).toHaveTextContent("Textbook");
  });

  test("exposes the quality description as tooltip label", () => {
    r(<QualityBadge quality="strong" />);
    // MUI Tooltip surfaces the title as the wrapper's aria-label.
    expect(screen.getByLabelText(QUALITY_INFO.strong.description)).toBeInTheDocument();
  });

  test("falls back to a capitalized label for unknown tiers", () => {
    r(<QualityBadge quality="weird" />);
    expect(screen.getByTestId("patterns-quality-weird")).toHaveTextContent("Weird");
  });
});

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

  test.each([
    ["textbook", "Textbook"],
    ["strong", "Strong"],
    ["fair", "Fair"],
    ["marginal", "Marginal"],
  ] as Array<[string, string]>)("renders tier %s with label %s", (quality, label) => {
    r(<QualityBadge quality={quality} />);
    expect(screen.getByTestId(`patterns-quality-${quality}`)).toHaveTextContent(label);
  });

  test.each([["TEXTBOOK", "patterns-quality-textbook", "Textbook"]])(
    "matches tier case-insensitively: %s",
    (quality, testId, label) => {
      r(<QualityBadge quality={quality} />);
      expect(screen.getByTestId(testId)).toHaveTextContent(label);
    },
  );

  test.each([
    [null, "patterns-quality-unknown"],
    [undefined, "patterns-quality-unknown"],
    ["", "patterns-quality-unknown"],
  ] as Array<[null | undefined | string, string]>)(
    "falls back to Unknown for missing quality %s",
    (quality, testId) => {
      r(<QualityBadge quality={quality} />);
      expect(screen.getByTestId(testId)).toHaveTextContent("Unknown");
    },
  );

  test("supports a custom data-testid override", () => {
    r(<QualityBadge quality="strong" data-testid="custom-quality" />);
    expect(screen.getByTestId("custom-quality")).toHaveTextContent("Strong");
  });
});

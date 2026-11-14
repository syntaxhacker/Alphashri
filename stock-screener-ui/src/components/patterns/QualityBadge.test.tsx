// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { QualityBadge } from "./QualityBadge";


describe("QualityBadge", () => {
  afterEach(() => cleanup());

  test("renders the tier label", () => {
    render(() => <QualityBadge quality="textbook" />);
    expect(screen.getByTestId("patterns-quality-textbook")).toHaveTextContent("Textbook");
  });

  test("exposes the quality description as tooltip label", async () => {
    render(() => <QualityBadge quality="strong" />);
    // The local Tooltip renders the label inside the bubble on hover.
    fireEvent.mouseOver(screen.getByTestId("patterns-quality-strong"));
    expect(await screen.findByText(QUALITY_INFO.strong.description)).toBeInTheDocument();
  });

  test("falls back to a capitalized label for unknown tiers", () => {
    render(() => <QualityBadge quality="weird" />);
    expect(screen.getByTestId("patterns-quality-weird")).toHaveTextContent("Weird");
  });

  test.each([
    ["textbook", "Textbook"],
    ["strong", "Strong"],
    ["fair", "Fair"],
    ["marginal", "Marginal"],
  ] as Array<[string, string]>)("renders tier %s with label %s", (quality, label) => {
    render(() => <QualityBadge quality={quality} />);
    expect(screen.getByTestId(`patterns-quality-${quality}`)).toHaveTextContent(label);
  });

  test.each([["TEXTBOOK", "patterns-quality-textbook", "Textbook"]])(
    "matches tier case-insensitively: %s",
    (quality, testId, label) => {
      render(() => <QualityBadge quality={quality} />);
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
      render(() => <QualityBadge quality={quality} />);
      expect(screen.getByTestId(testId)).toHaveTextContent("Unknown");
    },
  );

  test("supports a custom data-testid override", () => {
    render(() => <QualityBadge quality="strong" data-testid="custom-quality" />);
    expect(screen.getByTestId("custom-quality")).toHaveTextContent("Strong");
  });
});

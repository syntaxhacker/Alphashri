// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { SectionHeader } from "./SectionHeader";

const accentOf = (testId: string) =>
  screen.getByTestId(testId).firstElementChild as HTMLElement;

describe("SectionHeader", () => {
  test("renders the title beside a 4×18 accent rail using the default primary tone", () => {
    renderWithProviders(() => <SectionHeader title="Open positions" data-testid="header" />);

    const header = screen.getByTestId("header");
    expect(header).toHaveTextContent("Open positions");
    const accent = accentOf("header");
    expect(accent).toHaveClass("bg-fin-primary");
    expect(accent.style.width).toBe("4px");
    expect(accent.style.height).toBe("18px");
  });

  test("omits the badge for null/undefined but shows zero and string badges", () => {
    renderWithProviders(() => <SectionHeader title="No badge" data-testid="without" />);
    renderWithProviders(() => <SectionHeader title="Zero" badge={0} data-testid="zero" />);
    renderWithProviders(() => <SectionHeader title="Trades" badge="12" data-testid="string" />);

    expect(screen.getByTestId("without").children).toHaveLength(2);
    expect(screen.getByTestId("without")).toHaveTextContent("No badge");
    expect(screen.getByTestId("zero")).toHaveTextContent("0");
    expect(screen.getByTestId("string")).toHaveTextContent("12");
    expect(screen.getByTestId("string").children).toHaveLength(3);
  });

  test("maps named colours onto the shared accent tokens and falls back for unknown ones", () => {
    const cases: Array<[string, string]> = [
      ["blue", "bg-fin-primary"],
      ["green", "bg-fin-positive"],
      ["red", "bg-fin-negative"],
      ["orange", "bg-fin-warning"],
      ["teal", "bg-fin-info"],
      ["violet", "bg-fin-text-muted"],
      ["not-a-colour", "bg-fin-primary"],
    ];
    for (const [color, expected] of cases) {
      renderWithProviders(() =>
        <SectionHeader title={color} color={color} data-testid={`accent-${color}`} />,
      );
      expect(accentOf(`accent-${color}`), color).toHaveClass(expected);
    }
  });

  test("accepts the historical dataTestid spelling and prefers the canonical prop", () => {
    renderWithProviders(() => <SectionHeader title="Legacy" dataTestid="legacy-id" />);
    expect(screen.getByTestId("legacy-id")).toHaveTextContent("Legacy");

    renderWithProviders(() =>
      <SectionHeader title="Both" dataTestid="legacy-loses" data-testid="canonical-wins" />,
    );
    expect(screen.getByTestId("canonical-wins")).toHaveTextContent("Both");
    expect(screen.queryByTestId("legacy-loses")).not.toBeInTheDocument();
  });
});

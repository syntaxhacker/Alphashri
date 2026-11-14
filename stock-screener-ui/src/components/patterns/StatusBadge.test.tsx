// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { StatusBadge } from "./StatusBadge";


describe("StatusBadge", () => {
  afterEach(() => cleanup());

  test.each([
    ["confirmed", "Confirmed"],
    ["forming", "Forming"],
    ["failed", "Failed"],
    ["marginal", "Marginal"],
  ] as Array<[string, string]>)("renders status %s with label %s", (status, label) => {
    render(() => <StatusBadge status={status} />);
    expect(screen.getByTestId(`patterns-status-${status}`)).toHaveTextContent(label);
  });

  test("matches status case-insensitively", () => {
    render(() => <StatusBadge status="CONFIRMED" />);
    expect(screen.getByTestId("patterns-status-confirmed")).toHaveTextContent("Confirmed");
  });

  test("falls back to a capitalized label for unknown statuses", () => {
    render(() => <StatusBadge status="weird" />);
    expect(screen.getByTestId("patterns-status-weird")).toHaveTextContent("Weird");
  });

  test.each([
    [null, "patterns-status-unknown"],
    [undefined, "patterns-status-unknown"],
    ["", "patterns-status-unknown"],
  ] as Array<[null | undefined | string, string]>)(
    "falls back to Unknown for missing status %s",
    (status, testId) => {
      render(() => <StatusBadge status={status} />);
      expect(screen.getByTestId(testId)).toHaveTextContent("Unknown");
    },
  );

  test("supports a custom data-testid override", () => {
    render(() => <StatusBadge status="failed" data-testid="custom-status" />);
    expect(screen.getByTestId("custom-status")).toHaveTextContent("Failed");
  });

  test("uses the derived display label when provided", () => {
    render(() => <StatusBadge status="failed" display={{ label: "ARMED", tone: "info", tooltip: "t" }} />);
    expect(screen.getByTestId("patterns-status-failed")).toHaveTextContent("Armed");
  });

  test("falls back to the raw status when display is null", () => {
    render(() => <StatusBadge status="failed" display={null} />);
    expect(screen.getByTestId("patterns-status-failed")).toHaveTextContent("Failed");
  });
});

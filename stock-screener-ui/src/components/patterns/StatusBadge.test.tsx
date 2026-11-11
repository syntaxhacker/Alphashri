// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { StatusBadge } from "./StatusBadge";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("StatusBadge", () => {
  afterEach(() => cleanup());

  test.each([
    ["confirmed", "Confirmed"],
    ["forming", "Forming"],
    ["failed", "Failed"],
    ["marginal", "Marginal"],
  ] as Array<[string, string]>)("renders status %s with label %s", (status, label) => {
    r(<StatusBadge status={status} />);
    expect(screen.getByTestId(`patterns-status-${status}`)).toHaveTextContent(label);
  });

  test("matches status case-insensitively", () => {
    r(<StatusBadge status="CONFIRMED" />);
    expect(screen.getByTestId("patterns-status-confirmed")).toHaveTextContent("Confirmed");
  });

  test("falls back to a capitalized label for unknown statuses", () => {
    r(<StatusBadge status="weird" />);
    expect(screen.getByTestId("patterns-status-weird")).toHaveTextContent("Weird");
  });

  test.each([
    [null, "patterns-status-unknown"],
    [undefined, "patterns-status-unknown"],
    ["", "patterns-status-unknown"],
  ] as Array<[null | undefined | string, string]>)(
    "falls back to Unknown for missing status %s",
    (status, testId) => {
      r(<StatusBadge status={status} />);
      expect(screen.getByTestId(testId)).toHaveTextContent("Unknown");
    },
  );

  test("supports a custom data-testid override", () => {
    r(<StatusBadge status="failed" data-testid="custom-status" />);
    expect(screen.getByTestId("custom-status")).toHaveTextContent("Failed");
  });

  test("uses the derived display label when provided", () => {
    r(<StatusBadge status="failed" display={{ label: "ARMED", tone: "info", tooltip: "t" }} />);
    expect(screen.getByTestId("patterns-status-failed")).toHaveTextContent("Armed");
  });

  test("falls back to the raw status when display is null", () => {
    r(<StatusBadge status="failed" display={null} />);
    expect(screen.getByTestId("patterns-status-failed")).toHaveTextContent("Failed");
  });
});

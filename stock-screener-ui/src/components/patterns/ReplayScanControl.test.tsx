// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ReplayScanControl } from "./ReplayScanControl";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("ReplayScanControl", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("shows only the toggle until replay mode is enabled", () => {
    r(<ReplayScanControl onReplayScan={vi.fn()} />);
    expect(screen.getByTestId("patterns-replay-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-replay-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-replay-asof")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-replay-from")).not.toBeInTheDocument();
  });

  test("enabling replay reveals the as-of/from inputs and the slower warning", async () => {
    r(<ReplayScanControl onReplayScan={vi.fn()} />);
    await userEvent.click(screen.getByTestId("patterns-replay-toggle"));
    expect(screen.getByTestId("patterns-replay-asof")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByTestId("patterns-replay-from")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByTestId("patterns-replay-warning")).toHaveTextContent(/slower/i);
  });

  test("Run replay calls back with as_of_date/from_date values", async () => {
    const onReplayScan = vi.fn();
    r(<ReplayScanControl onReplayScan={onReplayScan} />);
    await userEvent.click(screen.getByTestId("patterns-replay-toggle"));
    fireEvent.change(screen.getByTestId("patterns-replay-asof"), {
      target: { value: "2026-09-30T14:30" },
    });
    fireEvent.change(screen.getByTestId("patterns-replay-from"), {
      target: { value: "2026-06-01T09:15" },
    });
    await userEvent.click(screen.getByTestId("patterns-replay-run"));
    expect(onReplayScan).toHaveBeenCalledWith({
      asOf: "2026-09-30T14:30",
      from: "2026-06-01T09:15",
    });
  });

  test("Run replay with empty inputs calls back with nulls (live)", async () => {
    const onReplayScan = vi.fn();
    r(<ReplayScanControl onReplayScan={onReplayScan} />);
    await userEvent.click(screen.getByTestId("patterns-replay-toggle"));
    await userEvent.click(screen.getByTestId("patterns-replay-run"));
    expect(onReplayScan).toHaveBeenCalledWith({ asOf: null, from: null });
  });
});

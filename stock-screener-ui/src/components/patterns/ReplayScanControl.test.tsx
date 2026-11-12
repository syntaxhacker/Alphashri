// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { ReplayScanControl } from "./ReplayScanControl";


describe("ReplayScanControl", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("shows only the toggle until replay mode is enabled", () => {
    render(() => <ReplayScanControl onReplayScan={vi.fn()} />);
    expect(screen.getByTestId("patterns-replay-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-replay-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-replay-asof")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-replay-from")).not.toBeInTheDocument();
  });

  test("enabling replay reveals the as-of/from inputs and the slower warning", async () => {
    render(() => <ReplayScanControl onReplayScan={vi.fn()} />);
    fireEvent.click(screen.getByTestId("patterns-replay-toggle"));
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
    render(() => <ReplayScanControl onReplayScan={onReplayScan} />);
    fireEvent.click(screen.getByTestId("patterns-replay-toggle"));
    fireEvent.input(screen.getByTestId("patterns-replay-asof"), {
      target: { value: "2026-09-30T14:30" },
    });
    fireEvent.input(screen.getByTestId("patterns-replay-from"), {
      target: { value: "2026-06-01T09:15" },
    });
    fireEvent.click(screen.getByTestId("patterns-replay-run"));
    expect(onReplayScan).toHaveBeenCalledWith({
      asOf: "2026-09-30T14:30",
      from: "2026-06-01T09:15",
    });
  });

  test("Run replay with empty inputs calls back with nulls (live)", async () => {
    const onReplayScan = vi.fn();
    render(() => <ReplayScanControl onReplayScan={onReplayScan} />);
    fireEvent.click(screen.getByTestId("patterns-replay-toggle"));
    fireEvent.click(screen.getByTestId("patterns-replay-run"));
    expect(onReplayScan).toHaveBeenCalledWith({ asOf: null, from: null });
  });
});

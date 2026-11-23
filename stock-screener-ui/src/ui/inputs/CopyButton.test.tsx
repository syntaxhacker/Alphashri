// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { CopyButton } from "./CopyButton";

const writeText = vi.fn<(text: string) => Promise<void>>();
const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalClipboard) Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(globalThis.navigator, "clipboard");
});

function renderCopy(value: string, timeout = 1000) {
  render(() => (
    <CopyButton value={value} timeout={timeout}>
      {({ copied, copy }) => (
        <>
          <button type="button" data-testid="copy-trigger" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <output data-testid="copy-state">{copied ? "yes" : "no"}</output>
        </>
      )}
    </CopyButton>
  ));
  // The render prop re-runs when `copied` flips, replacing its DOM subtree.
  return {
    trigger: () => screen.getByTestId("copy-trigger"),
    state: () => screen.getByTestId("copy-state"),
  };
}

describe("CopyButton", () => {
  test("writes the value on click, confirms, then clears the flag at the timeout", async () => {
    const { trigger, state } = renderCopy("NSE_EQ|INE002A01018", 200);
    expect(state()).toHaveTextContent(/^no$/);

    fireEvent.click(trigger());
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith("NSE_EQ|INE002A01018");
    expect(state()).toHaveTextContent(/^yes$/);

    await vi.advanceTimersByTimeAsync(199);
    expect(state()).toHaveTextContent(/^yes$/);
    await vi.advanceTimersByTimeAsync(1);
    expect(state()).toHaveTextContent(/^no$/);
  });

  test("an empty payload is written verbatim and still reports success", async () => {
    const { trigger, state } = renderCopy("");

    fireEvent.click(trigger());
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith("");
    expect(state()).toHaveTextContent(/^yes$/);
  });

  test("a rejected clipboard write keeps the confirmation off", async () => {
    writeText.mockRejectedValueOnce(new Error("permission denied"));
    const { trigger, state } = renderCopy("SECRET");

    fireEvent.click(trigger());
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith("SECRET");
    expect(state()).toHaveTextContent(/^no$/);
  });
});

import { describe, expect, test, beforeEach } from "vitest";
import {
  abortPendingRequest,
  getAbortSignal,
  isAbortError,
  clearAbortController,
} from "./useFetch";

beforeEach(() => {
  clearAbortController();
});

describe("abortPendingRequest", () => {
  test("returns an AbortController instance", () => {
    const controller = abortPendingRequest();
    expect(controller).toBeInstanceOf(AbortController);
  });

  test("aborts the previous controller when called again", () => {
    const first = abortPendingRequest();
    const second = abortPendingRequest();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  test("subsequent calls each abort the previous", () => {
    const controllers = [abortPendingRequest(), abortPendingRequest(), abortPendingRequest()];
    expect(controllers[0].signal.aborted).toBe(true);
    expect(controllers[1].signal.aborted).toBe(true);
    expect(controllers[2].signal.aborted).toBe(false);
  });

  test("works when no previous controller exists", () => {
    const controller = abortPendingRequest();
    expect(controller.signal.aborted).toBe(false);
  });
});

describe("getAbortSignal", () => {
  test("returns null when no controller exists", () => {
    expect(getAbortSignal()).toBeNull();
  });

  test("returns the signal after abortPendingRequest is called", () => {
    const controller = abortPendingRequest();
    const signal = getAbortSignal();
    expect(signal).toBe(controller.signal);
  });

  test("returns null after clearAbortController", () => {
    abortPendingRequest();
    clearAbortController();
    expect(getAbortSignal()).toBeNull();
  });
});

describe("isAbortError", () => {
  test("returns true for a DOMException with name AbortError", () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  test("returns false for a generic Error", () => {
    expect(isAbortError(new Error("network failure"))).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isAbortError("abort")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });

  test("returns true for error from an actual abort", () => {
    const controller = abortPendingRequest();
    controller.abort();
    controller.signal.addEventListener("error", () => {});
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
  });
});

describe("clearAbortController", () => {
  test("clears the current controller without aborting it", () => {
    const controller = abortPendingRequest();
    clearAbortController();
    expect(controller.signal.aborted).toBe(false);
    expect(getAbortSignal()).toBeNull();
  });

  test("allows new controllers to be created after clearing", () => {
    abortPendingRequest();
    clearAbortController();
    const newController = abortPendingRequest();
    expect(newController.signal.aborted).toBe(false);
    expect(getAbortSignal()).toBe(newController.signal);
  });
});

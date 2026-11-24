// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import type { JSX } from "solid-js";
import { fireEvent, render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { InlineLoader, EmptyState, ErrorAlert } from "./states";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

describe("InlineLoader", () => {
  it("renders a progressbar", () => {
    render(() => (<InlineLoader />), { wrapper: Wrapper });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(() => (<EmptyState title="No data" description="Try again later" />), { wrapper: Wrapper });
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("Try again later")).toBeInTheDocument();
  });

  it("renders without description", () => {
    render(() => (<EmptyState title="Empty" />), { wrapper: Wrapper });
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });
});

describe("ErrorAlert", () => {
  it("renders error message", () => {
    render(() => (<ErrorAlert message="Something went wrong" />), { wrapper: Wrapper });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("keeps the message block and the retry action in separate wrappers", () => {
    render(() => (
      <ErrorAlert data-testid="load-error" message="Feed unavailable" withRetry onRetry={() => {}} />
    ), { wrapper: Wrapper });
    const message = screen.getByTestId("load-error-message");
    const action = screen.getByTestId("load-error-action");
    const retry = screen.getByTestId("load-error-retry");
    expect(message).toHaveTextContent("Feed unavailable");
    expect(retry.parentElement).toBe(action);
    expect(message.parentElement).toBe(action.parentElement);
    expect(message).not.toContainElement(retry);
    expect(action).not.toContainElement(message);
  });

  it("stacks the action at narrow widths and keeps it compact at wide widths", () => {
    render(() => (
      <ErrorAlert data-testid="load-error" message="Feed unavailable" withRetry onRetry={() => {}} />
    ), { wrapper: Wrapper });
    const layout = screen.getByTestId("load-error-message").parentElement!;
    const action = screen.getByTestId("load-error-action");
    expect(layout).toHaveClass("flex-col", "sm:flex-row", "gap-2");
    expect(action).toHaveClass("w-full", "justify-end", "sm:w-auto");
    expect(screen.getByTestId("load-error-retry")).toHaveClass("w-full", "sm:w-auto");
  });

  it("preserves alert semantics and the retry callback", () => {
    const onRetry = vi.fn();
    render(() => (
      <ErrorAlert data-testid="load-error" title="Load failed" message="Feed unavailable" withRetry onRetry={onRetry} />
    ), { wrapper: Wrapper });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "load-error");
    expect(alert).toHaveTextContent("Load failed");
    fireEvent.click(screen.getByTestId("load-error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

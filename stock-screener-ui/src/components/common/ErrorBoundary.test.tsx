import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ throwIt }: { throwIt: boolean }) {
  if (throwIt) throw new Error("chart exploded");
  return <div data-testid="ok-child">all good</div>;
}

function wrap(ui: JSX.Element) {
  return render(() => (<UIProvider>{ui}</UIProvider>));
}

afterEach(() => cleanup());

describe("ErrorBoundary", () => {
  test("shows a fallback with retry and reload instead of a blank page", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    wrap(
      <ErrorBoundary label="Market screener">
        <Boom throwIt />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Market screener hit an error")).toBeInTheDocument();
    expect(screen.getByText("chart exploded")).toBeInTheDocument();
    expect(screen.getByTestId("ui-error-retry")).toBeInTheDocument();
    expect(screen.getByTestId("ui-error-reload")).toBeInTheDocument();
    spy.mockRestore();
  });

  test("retry renders the child again once the error condition clears", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let throwing = true;
    function Recoverable() {
      if (throwing) throw new Error("temporary");
      return <div data-testid="ok-child">recovered</div>;
    }
    wrap(
      <ErrorBoundary label="Chart">
        <Recoverable />
      </ErrorBoundary>,
    );
    throwing = false;
    fireEvent.click(screen.getByTestId("ui-error-retry"));
    expect(screen.getByTestId("ok-child")).toHaveTextContent("recovered");
    spy.mockRestore();
  });

});

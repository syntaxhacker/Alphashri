import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { Show } from "solid-js";
import { UIProvider, Portal } from "@/ui";

function X() {
  return (
    <Show when={true}>
      <Portal>
        <div data-testid="inside-show">x</div>
      </Portal>
    </Show>
  );
}

function Y() {
  return (
    <UIProvider>
      <Portal>
        <div data-testid="inside-ui">x</div>
      </Portal>
    </UIProvider>
  );
}

afterEach(() => {
  cleanup();
  console.log("BODY:", document.body.innerHTML);
});

describe("portal cleanup culprit", () => {
  test("portal inside Show is removed on dispose", () => {
    render(() => <X />);
    expect(screen.getByTestId("inside-show")).toBeInTheDocument();
  });

  test("portal inside UIProvider is removed on dispose", () => {
    render(() => <Y />);
    expect(screen.getByTestId("inside-ui")).toBeInTheDocument();
  });
});
